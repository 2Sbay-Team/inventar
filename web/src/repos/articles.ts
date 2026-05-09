import { type InventarDB } from '../db/db';
import { computeSearchBlob } from '../query/search-blob';
import { type Article, type Category, type Movement, type UUID, type Variant } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';
import { nextInternalCode } from './internal-code';

// SPEC §2.5 Add Article: photo → name → sizes → quantities → prices → save.
// One Article + one Variant per size + one initial purchase Movement per
// non-zero starting qty are created in a single Dexie transaction so we
// either land all of them or none of them; a partial save would leave the
// catalogue with a sizeless article or a variant with no audit trail.

export interface CreateArticleInput {
  name: string;
  photo_id: UUID | null;
  category: Category;
  colors: string[];
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  // Each size with its initial quantity. Quantity 0 still creates the
  // variant (so the size grid lists it), but skips the seed movement.
  sizes: Array<{ size: string; initial_qty: number }>;
  // Optional: SKU prefix for the auto-allocated internal_code. Defaults
  // to 'SH' if omitted. Callers that know the active store_type should
  // pass STORE_TYPES[store_type].sku_prefix.
  sku_prefix?: string;
}

export interface CreateArticleResult {
  article: Article;
  variants: Variant[];
  movements: Movement[];
}

export async function createArticle(
  db: InventarDB,
  input: CreateArticleInput,
): Promise<CreateArticleResult> {
  for (const s of input.sizes) {
    if (!Number.isInteger(s.initial_qty) || s.initial_qty < 0) {
      throw new Error(`initial_qty must be a non-negative integer, got ${s.initial_qty}`);
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
      colors: input.colors.map((c) => c.toLowerCase()),
      brand: input.brand,
      cost_price_tnd: input.cost_price_tnd,
      sale_price_tnd: input.sale_price_tnd,
      notes: input.notes,
      search_blob: '', // filled in just below
      updated_at: ts,
      archived_at: null,
      deleted_at: null,
    };
    article.search_blob = computeSearchBlob(article);
    await db.articles.add(article);

    const variants: Variant[] = [];
    const movements: Movement[] = [];

    for (const { size, initial_qty } of input.sizes) {
      const variant: Variant = {
        id: newUUID(),
        article_id: articleId,
        size: size.trim(),
        hidden: false,
        updated_at: ts,
        deleted_at: null,
      };
      await db.variants.add(variant);
      variants.push(variant);

      if (initial_qty > 0) {
        const m: Movement = {
          id: newUUID(),
          variant_id: variant.id,
          delta: initial_qty,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
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
    | 'colors'
    | 'brand'
    | 'cost_price_tnd'
    | 'sale_price_tnd'
    | 'notes'
  >
>;

// Edits a subset of indexed/searchable fields. We always recompute
// `search_blob` (DATA_MODEL §5: deterministic on every create/update) and
// bump `updated_at` so import-merge picks the newer revision. Lifecycle
// fields (archived_at, deleted_at, internal_code, id) are deliberately NOT
// patchable through this function — see archiveArticle / hardDeleteArticle.
export async function updateArticle(
  db: InventarDB,
  id: UUID,
  patch: UpdateArticleInput,
): Promise<Article> {
  const ts = nowISO();
  return db.transaction('rw', db.articles, async () => {
    const existing = await db.articles.get(id);
    if (!existing) throw new Error(`No article with id ${id}`);
    if (existing.deleted_at !== null) {
      throw new Error(`Article ${id} is deleted`);
    }
    const merged: Article = {
      ...existing,
      ...patch,
      colors: (patch.colors ?? existing.colors).map((c) => c.toLowerCase()),
      updated_at: ts,
    };
    merged.search_blob = computeSearchBlob(merged);
    await db.articles.put(merged);
    return merged;
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

  // `recent` rides the indexed `updated_at` cursor; `name` has no index
  // in the v1 schema (see DATA_MODEL §3) so we pull and sort in memory.
  // At MVP scale (≤ 500 articles per SPEC §5) the in-memory cost is
  // negligible.
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
