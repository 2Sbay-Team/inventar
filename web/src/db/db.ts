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
  }
}

export const db = new InventarDB();
