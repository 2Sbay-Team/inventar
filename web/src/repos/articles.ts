import { type InventarDB } from '../db/db';
import { computeSearchBlob } from '../query/search-blob';
import { type Article, type Category, type Movement, type UUID, type Variant } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';
import { nextInternalCode } from './internal-code';

// SPEC §2.5 / ADR-011 / ADR-012: Add Article persists one Article + one
// Variant per (colour, size) + one initial purchase Movement per non-zero
// starting qty per location. Everything happens in a single Dexie
// transaction so we either land all of them or none of them.
//
// Two input shapes are accepted while the v0.3 transition is in flight:
//
//   * `variants[]` — the canonical post-v0.3 shape, one entry per
//     (colour, size) cell, with floor_qty + back_qty kept distinct.
//   * `colors[]` + `sizes[]` — the legacy v1 shape, used by the seed
//     surface and the not-yet-rewritten Add Article screen. Translated
//     in-line into the canonical shape: cartesian product of colours ×
//     sizes, all initial stock booked to `back` (matches the v5→v6
//     migration's default).
//
// `Article.colors` is kept as a denormalised cache during the transition
// so legacy reads keep working. It's recomputed from the produced
// variants on every create / update.

export interface CreateVariantSpec {
  color: string | null;
  size: string | null;
  floor_qty: number;
  back_qty: number;
  photo_id?: UUID | null;
}

interface CreateArticleInputCommon {
  name: string;
  photo_id: UUID | null;
  category: Category;
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  // Optional: SKU prefix for the auto-allocated internal_code. Defaults
  // to 'SH' if omitted.
  sku_prefix?: string;
  // v0.5 ADR-017: factory EAN-13 / UPC. Optional — set by the /receive
  // mini-form when the merchant scans a barcode that doesn't match any
  // existing article. Indexed for fast scanner lookup.
  barcode_ean?: string | null;
  // v0.5 ADR-017: optional reorder threshold. When the variant's stock
  // drops below this number, the search/list views show a "Low (N left)"
  // badge and the dashboard's "Items running low" widget counts the
  // article. Null = disabled (the default for legacy articles).
  min_stock_threshold?: number | null;
}

export interface CreateArticleInputV2 extends CreateArticleInputCommon {
  variants: CreateVariantSpec[];
}

export interface CreateArticleInputLegacy extends CreateArticleInputCommon {
  // DEPRECATED v0.3 — translated to `variants` in-line.
  colors: string[];
  sizes: Array<{ size: string; initial_qty: number }>;
}

export type CreateArticleInput = CreateArticleInputV2 | CreateArticleInputLegacy;

export interface CreateArticleResult {
  article: Article;
  variants: Variant[];
  movements: Movement[];
}

function isV2(input: CreateArticleInput): input is CreateArticleInputV2 {
  return Array.isArray((input as CreateArticleInputV2).variants);
}

function legacyToV2(input: CreateArticleInputLegacy): CreateVariantSpec[] {
  // Empty colour list → single colourless dimension. The active store_type
  // determines whether that colourlessness is "actually has no colours"
  // (kiosk/grocery) or "just wasn't entered yet" (legacy shoes/clothes).
  // We don't have store_type here; the migration kernel handles the
  // legacy-shoe-with-empty-colours case at upgrade time. For new articles
  // entering through this legacy shim, an empty colours[] from the UI is
  // taken at face value: produce colourless variants.
  const colors: Array<string | null> =
    input.colors.length > 0 ? input.colors.map((c) => c.toLowerCase()) : [null];
  const sizes: Array<{ size: string | null; initial_qty: number }> =
    input.sizes.length > 0
      ? input.sizes.map((s) => ({
          size: s.size === '' ? null : s.size,
          initial_qty: s.initial_qty,
        }))
      : [{ size: null, initial_qty: 0 }];
  const out: CreateVariantSpec[] = [];
  for (const color of colors) {
    for (const s of sizes) {
      out.push({
        color,
        size: s.size,
        floor_qty: 0,
        back_qty: s.initial_qty,
        photo_id: null,
      });
    }
  }
  return out;
}

function uniqueVariantColors(variants: CreateVariantSpec[]): string[] {
  const set = new Set<string>();
  for (const v of variants) {
    if (v.color === null) continue;
    set.add(v.color);
  }
  return Array.from(set);
}

export async function createArticle(
  db: InventarDB,
  input: CreateArticleInput,
): Promise<CreateArticleResult> {
  const variantSpecs = isV2(input) ? input.variants : legacyToV2(input);

  for (const v of variantSpecs) {
    if (!Number.isInteger(v.floor_qty) || v.floor_qty < 0) {
      throw new Error(`floor_qty must be a non-negative integer, got ${v.floor_qty}`);
    }
    if (!Number.isInteger(v.back_qty) || v.back_qty < 0) {
      throw new Error(`back_qty must be a non-negative integer, got ${v.back_qty}`);
    }
  }

  const ts = nowISO();
  return db.transaction('rw', [db.articles, db.variants, db.movements], async () => {
    const internal_code = await nextInternalCode(db, input.sku_prefix);
    const articleId = newUUID();

    const article: Article = {
      id: articleId,
      internal_code,
      name: input.name,
      photo_id: input.photo_id,
      category: input.category,
      colors: uniqueVariantColors(variantSpecs),
      brand: input.brand,
      cost_price_tnd: input.cost_price_tnd,
      sale_price_tnd: input.sale_price_tnd,
      notes: input.notes,
      barcode_ean: input.barcode_ean ?? null,
      min_stock_threshold: input.min_stock_threshold ?? null,
      search_blob: '', // filled in just below
      updated_at: ts,
      archived_at: null,
      deleted_at: null,
    };
    article.search_blob = computeSearchBlob(article, variantSpecs);
    await db.articles.add(article);

    const variants: Variant[] = [];
    const movements: Movement[] = [];

    for (const spec of variantSpecs) {
      const variant: Variant = {
        id: newUUID(),
        article_id: articleId,
        color: spec.color === null ? null : spec.color.toLowerCase(),
        size: spec.size === null ? null : spec.size.trim(),
        photo_id: spec.photo_id ?? null,
        hidden: false,
        updated_at: ts,
        deleted_at: null,
      };
      await db.variants.add(variant);
      variants.push(variant);

      for (const [location, qty] of [
        ['floor', spec.floor_qty] as const,
        ['back', spec.back_qty] as const,
      ]) {
        if (qty <= 0) continue;
        const m: Movement = {
          id: newUUID(),
          variant_id: variant.id,
          delta: qty,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location,
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: null,
          lot_id: null,
          refunds_movement_id: null,
          created_at: ts,
          deleted_at: null,
        };
        await db.movements.add(m);
        movements.push(m);
      }
    }

    return { article, variants, movements };
  });
}

// Returns undefined for missing AND tombstoned articles. Archived rows
// stay visible — the UI decides whether to show them based on the
// "Show archived" toggle in SPEC §2.8.
export async function getArticle(db: InventarDB, id: UUID): Promise<Article | undefined> {
  const a = await db.articles.get(id);
  if (!a || a.deleted_at !== null) return undefined;
  return a;
}

export type UpdateArticleInput = Partial<
  Pick<
    Article,
    | 'name'
    | 'photo_id'
    | 'category'
    | 'brand'
    | 'cost_price_tnd'
    | 'sale_price_tnd'
    | 'notes'
    | 'barcode_ean'
    | 'min_stock_threshold'
  >
>;

// v0.5 ADR-018: scanner-driven lookup. The /receive flow reads this on
// every successful scan to decide between "match → bottom-sheet quantity
// picker" and "no match → mini-form for new product". Returns the first
// matching alive article (uniqueness of EANs is enforced at the input
// boundary, but we don't trust the index alone — a future bulk import
// could land duplicates).
export async function findArticleByEAN(db: InventarDB, ean: string): Promise<Article | undefined> {
  const trimmed = ean.trim();
  if (trimmed === '') return undefined;
  const row = await db.articles.where('barcode_ean').equals(trimmed).first();
  if (!row || row.deleted_at !== null) return undefined;
  return row;
}

// v0.5.1: secondary scan-resolution path. internal_code is the
// short-SKU the merchant would print on a Code-128 / Code-39 label
// when a product has no factory EAN. The catalogue index lets us
// resolve the article in O(1). Lookup is exact (no fuzzy match) so
// the worst case for a typo on a printed label is "not found", never
// the wrong article.
export async function findArticleByInternalCode(
  db: InventarDB,
  code: string,
): Promise<Article | undefined> {
  const trimmed = code.trim();
  if (trimmed === '') return undefined;
  const row = await db.articles.where('internal_code').equals(trimmed).first();
  if (!row || row.deleted_at !== null) return undefined;
  return row;
}

// Edits a subset of indexed/searchable fields. We always recompute
// `search_blob` (DATA_MODEL §5: deterministic on every create/update) and
// bump `updated_at` so import-merge picks the newer revision.
export async function updateArticle(
  db: InventarDB,
  id: UUID,
  patch: UpdateArticleInput,
): Promise<Article> {
  const ts = nowISO();
  return db.transaction('rw', [db.articles, db.variants], async () => {
    const existing = await db.articles.get(id);
    if (!existing) throw new Error(`No article with id ${id}`);
    if (existing.deleted_at !== null) {
      throw new Error(`Article ${id} is deleted`);
    }
    const variants = await db.variants
      .where('article_id')
      .equals(id)
      .filter((v) => v.deleted_at === null)
      .toArray();
    const colors = uniqueVariantColors(
      variants.map((v) => ({
        color: v.color,
        size: v.size,
        floor_qty: 0,
        back_qty: 0,
      })),
    );
    const merged: Article = {
      ...existing,
      ...patch,
      colors,
      updated_at: ts,
    };
    merged.search_blob = computeSearchBlob(merged, variants);
    await db.articles.put(merged);
    return merged;
  });
}

// Recomputes `Article.colors` (the denormalised cache) and `search_blob`
// from the current variants. Called after any write that adds, removes,
// or renames a variant on an article — keeps the article-level fields in
// sync without forcing every caller to remember to do it.
export async function refreshArticleDenormalisedFields(
  db: InventarDB,
  articleId: UUID,
): Promise<void> {
  const ts = nowISO();
  await db.transaction('rw', [db.articles, db.variants], async () => {
    const a = await db.articles.get(articleId);
    if (!a) return;
    const variants = await db.variants
      .where('article_id')
      .equals(articleId)
      .filter((v) => v.deleted_at === null)
      .toArray();
    const colors = uniqueVariantColors(
      variants.map((v) => ({
        color: v.color,
        size: v.size,
        floor_qty: 0,
        back_qty: 0,
      })),
    );
    const next: Article = { ...a, colors, updated_at: ts };
    next.search_blob = computeSearchBlob(next, variants);
    await db.articles.put(next);
  });
}

export async function archiveArticle(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.articles.update(id, { archived_at: ts, updated_at: ts });
  if (updated === 0) throw new Error(`No article with id ${id}`);
}

export async function unarchiveArticle(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.articles.update(id, { archived_at: null, updated_at: ts });
  if (updated === 0) throw new Error(`No article with id ${id}`);
}

// ADR-004 hard delete: cascades to variants, movements, and the photo.
// Used only after the user types "DELETE" in the confirmation dialog
// (SPEC §2.3). Wrapped in a transaction so the catalogue cannot end up
// pointing at orphan rows if any single delete fails.
export async function hardDeleteArticle(db: InventarDB, id: UUID): Promise<void> {
  await db.transaction('rw', [db.articles, db.variants, db.movements, db.photos], async () => {
    const article = await db.articles.get(id);
    if (!article) throw new Error(`No article with id ${id}`);

    const variantIds = (await db.variants.where('article_id').equals(id).primaryKeys()) as UUID[];

    if (variantIds.length > 0) {
      await db.movements.where('variant_id').anyOf(variantIds).delete();
      await db.variants.bulkDelete(variantIds);
    }

    if (article.photo_id) {
      await db.photos.delete(article.photo_id);
    }

    await db.articles.delete(id);
  });
}

export interface ListArticlesOptions {
  // Default false: archived rows hidden. SPEC §2.8 List screen exposes a
  // "Show archived" toggle that flips this.
  includeArchived?: boolean;
  category?: Category;
  // SPEC §2.8 sort options. "stock" / "margin" depend on derived numbers
  // and are computed in the screen layer; the repo only does the cheap
  // index-backed sorts.
  sort?: 'recent' | 'name';
  limit?: number;
}

export async function listArticles(
  db: InventarDB,
  opts: ListArticlesOptions = {},
): Promise<Article[]> {
  const sort = opts.sort ?? 'recent';

  let rows: Article[] =
    sort === 'recent'
      ? await db.articles.orderBy('updated_at').reverse().toArray()
      : await db.articles.toArray();

  rows = rows.filter((a) => {
    if (a.deleted_at !== null) return false;
    if (!opts.includeArchived && a.archived_at !== null) return false;
    if (opts.category && a.category !== opts.category) return false;
    return true;
  });

  if (sort === 'name') {
    rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  return opts.limit !== undefined ? rows.slice(0, opts.limit) : rows;
}
