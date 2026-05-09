import Dexie, { type Table } from 'dexie';
import type { Article, Expense, MetaRow, Movement, Photo, ShopProfile, Variant } from '../types';
import { META_KEYS } from '../repos/meta';
import {
  migrateRowsV5ToV6,
  type V5Article,
  type V5Movement,
  type V5ShopProfile,
  type V5Variant,
} from './migrate-v5-to-v6';

export const DB_NAME = 'inventar';

export class InventarDB extends Dexie {
  profile!: Table<ShopProfile, string>;
  articles!: Table<Article, string>;
  variants!: Table<Variant, string>;
  movements!: Table<Movement, string>;
  expenses!: Table<Expense, string>;
  photos!: Table<Photo, string>;
  meta!: Table<MetaRow, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      profile: 'id',
      articles:
        'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
      variants: 'id, article_id, [article_id+size], deleted_at',
      movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
      expenses: 'id, category, at, deleted_at',
      photos: 'id, deleted_at',
      meta: 'key',
    });
    // v2: Add logo_photo_id (non-indexed) to ShopProfile. Schema strings are
    // unchanged — the bump exists purely to backfill the new field on rows
    // that predate the change so reads return null instead of undefined.
    this.version(2)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { logo_photo_id?: string | null }) => {
            if (!('logo_photo_id' in p)) p.logo_photo_id = null;
          });
      });
    // v3: Add currency (non-indexed) to ShopProfile, defaulting to 'TND' for
    // existing installs (the only currency that ever existed before this
    // migration). New rows pick a currency at onboarding.
    this.version(3)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { currency?: string }) => {
            if (!('currency' in p)) p.currency = 'TND';
          });
      });
    // v4: Add store_type to ShopProfile, default 'shoes' for existing
    // installs (the only thing the app supported pre-multi-vertical).
    this.version(4)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { store_type?: string }) => {
            if (!('store_type' in p)) p.store_type = 'shoes';
          });
      });
    // v5: Add unit_price_tnd to Movement, defaulting to null on existing
    // rows. null means "use the article's current sale_price_tnd at read
    // time" — preserves prior revenue calculations exactly.
    this.version(5)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('movements')
          .toCollection()
          .modify((m: { unit_price_tnd?: number | null }) => {
            if (!('unit_price_tnd' in m)) m.unit_price_tnd = null;
          });
      });
    // v6: ADR-011 / ADR-012. Three structural changes:
    //   1. Drop the *colors multi-entry index from articles. The colours[]
    //      cache stays as a denormalised field for legacy reads through
    //      the v0.3 transition, but indexed colour lookup moves to
    //      Variant.color via the new [article_id+color+size] compound.
    //   2. Variants gain `color` and `photo_id`. Existing variants fan
    //      out — one new variant per (article.colors[] × old variant).
    //      Legacy variant rows get tombstoned (deleted_at set) so old
    //      backups re-imported still find them by id.
    //   3. Movements gain `location`, `transfer_from`, `transfer_to`.
    //      Every existing movement is remapped to a new variant id; on
    //      ambiguity (article had ≥2 colours), we attribute to the
    //      alphabetically-first colour and append a marker note so the
    //      review screen lists it.
    this.version(6)
      .stores({
        profile: 'id',
        articles: 'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Read every legacy row up front. The catalogue is small (MVP cap
        // ~500 articles per SPEC §5) so reading into memory is cheap and
        // lets us run the pure transformation kernel without juggling
        // partial state inside the upgrade callback.
        const profileRow = (await tx.table('profile').get('singleton')) as
          | V5ShopProfile
          | undefined;
        const articles = (await tx.table('articles').toArray()) as V5Article[];
        const variants = (await tx.table('variants').toArray()) as V5Variant[];
        const movements = (await tx.table('movements').toArray()) as V5Movement[];

        const { rows, report } = migrateRowsV5ToV6({
          profile: profileRow ?? null,
          articles,
          variants,
          movements,
        });

        // Replace variants and movements wholesale. Articles get an
        // in-place patch so we don't lose any field that the migration
        // didn't touch (the kernel only rewrites `colors`).
        await tx.table('variants').clear();
        if (rows.variants.length > 0) {
          await tx.table('variants').bulkAdd(rows.variants);
        }
        await tx.table('movements').clear();
        if (rows.movements.length > 0) {
          await tx.table('movements').bulkAdd(rows.movements);
        }
        for (const a of rows.articles) {
          await tx.table('articles').put(a);
        }

        await tx.table('meta').put({
          key: META_KEYS.migration_v6_completed_at,
          value: new Date().toISOString(),
        });
        // Stash the report for the migration-review screen / banner so
        // the UI doesn't have to recompute it from scratch.
        await tx.table('meta').put({
          key: 'migration_v6_report',
          value: report,
        });
      });
  }
}

export const db = new InventarDB();

// One-shot full database wipe used by Settings → Reset everything (SPEC §2.9
// destructive flow). Lives in /src/db/ so call sites don't have to reach
// for raw indexedDB outside this folder.
export async function resetDatabase(): Promise<void> {
  db.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // other tab still open; resolve anyway
  });
}
