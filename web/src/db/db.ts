import Dexie, { type Table } from 'dexie';
import type { Article, Expense, MetaRow, Movement, Photo, ShopProfile, Variant } from '../types';

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
