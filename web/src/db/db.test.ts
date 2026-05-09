import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from './db';
import type { Variant } from '../types';

describe('InventarDB schema (v5)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('opens at version 5', () => {
    expect(db.verno).toBe(5);
  });

  it('has the seven tables from DATA_MODEL §3', () => {
    const names = db.tables.map((t) => t.name).sort();
    expect(names).toEqual([
      'articles',
      'expenses',
      'meta',
      'movements',
      'photos',
      'profile',
      'variants',
    ]);
  });

  it('articles: primKey id + the seven indexes from DATA_MODEL §3', () => {
    const t = db.table('articles');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      'archived_at',
      'category',
      'colors',
      'deleted_at',
      'internal_code',
      'search_blob',
      'updated_at',
    ]);
    const colors = t.schema.indexes.find((i) => i.name === 'colors');
    expect(colors?.multi).toBe(true);
  });

  it('variants: primKey id + compound [article_id+size]', () => {
    const t = db.table('variants');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual(['[article_id+size]', 'article_id', 'deleted_at']);
    const compound = t.schema.indexes.find((i) => i.name === '[article_id+size]');
    expect(compound?.compound).toBe(true);
    expect(compound?.keyPath).toEqual(['article_id', 'size']);
  });

  it('movements: primKey id + compound [variant_id+created_at]', () => {
    const t = db.table('movements');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      '[variant_id+created_at]',
      'created_at',
      'deleted_at',
      'type',
      'variant_id',
    ]);
    const compound = t.schema.indexes.find((i) => i.name === '[variant_id+created_at]');
    expect(compound?.compound).toBe(true);
    expect(compound?.keyPath).toEqual(['variant_id', 'created_at']);
  });

  it('expenses: primKey id + 3 indexes', () => {
    const t = db.table('expenses');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual(['at', 'category', 'deleted_at']);
  });

  it('photos: primKey id + deleted_at index only', () => {
    const t = db.table('photos');
    expect(t.schema.primKey.name).toBe('id');
    expect(t.schema.indexes.map((i) => i.name)).toEqual(['deleted_at']);
  });

  it('profile: primKey id, no indexes', () => {
    const t = db.table('profile');
    expect(t.schema.primKey.name).toBe('id');
    expect(t.schema.indexes).toEqual([]);
  });

  it('meta: primKey key, no indexes', () => {
    const t = db.table('meta');
    expect(t.schema.primKey.name).toBe('key');
    expect(t.schema.indexes).toEqual([]);
  });
});

describe('InventarDB CRUD smoke (v1)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  const NOW: string = '2026-05-05T00:00:00.000Z';

  it('round-trips ShopProfile (singleton id)', async () => {
    await db.profile.put({
      id: 'singleton',
      name: 'Naili Shoes',
      locale: 'fr',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'shoes',
      created_at: NOW,
      updated_at: NOW,
      last_backup_at: null,
    });
    const read = await db.profile.get('singleton');
    expect(read?.name).toBe('Naili Shoes');
    expect(read?.locale).toBe('fr');
    expect(read?.logo_photo_id).toBeNull();
    expect(read?.currency).toBe('TND');
    expect(read?.store_type).toBe('shoes');
  });

  it('queries variants by [article_id+size] compound index', async () => {
    const articleId = 'a-1';
    await db.variants.bulkAdd([
      {
        id: 'v-39',
        article_id: articleId,
        size: '39',
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
      {
        id: 'v-40',
        article_id: articleId,
        size: '40',
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
      {
        id: 'v-41',
        article_id: articleId,
        size: '41',
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
    ]);
    const v40 = await db.variants.where('[article_id+size]').equals([articleId, '40']).first();
    expect(v40?.id).toBe('v-40');
  });

  it('queries movements by [variant_id+created_at] for the activity feed', async () => {
    const variantId = 'v-1';
    const mk = (id: string, t: string): Parameters<typeof db.movements.add>[0] => ({
      id,
      variant_id: variantId,
      delta: 1,
      type: 'purchase',
      note: null,
      unit_price_tnd: null,
      created_at: t,
      deleted_at: null,
    });
    await db.movements.bulkAdd([
      mk('m-1', '2026-05-01T00:00:00.000Z'),
      mk('m-2', '2026-05-02T00:00:00.000Z'),
      mk('m-3', '2026-05-03T00:00:00.000Z'),
    ]);
    const recent = await db.movements
      .where('[variant_id+created_at]')
      .between([variantId, '2026-05-02T00:00:00.000Z'], [variantId, '￿'])
      .toArray();
    expect(recent.map((m) => m.id).sort()).toEqual(['m-2', 'm-3']);
  });

  it('uses *colors multi-entry index for color filter', async () => {
    await db.articles.bulkAdd([
      {
        id: 'a-1',
        internal_code: 'SH-0001',
        name: 'White running',
        photo_id: null,
        category: 'sport',
        colors: ['white', 'gray'],
        brand: null,
        cost_price_tnd: 30000,
        sale_price_tnd: 60000,
        notes: null,
        search_blob: 'white running gray sport sh-0001',
        updated_at: NOW,
        archived_at: null,
        deleted_at: null,
      },
      {
        id: 'a-2',
        internal_code: 'SH-0002',
        name: 'Black dress',
        photo_id: null,
        category: 'dress',
        colors: ['black'],
        brand: null,
        cost_price_tnd: 40000,
        sale_price_tnd: 80000,
        notes: null,
        search_blob: 'black dress sh-0002',
        updated_at: NOW,
        archived_at: null,
        deleted_at: null,
      },
    ]);
    const whites = await db.articles.where('colors').equals('white').toArray();
    expect(whites.map((a) => a.id)).toEqual(['a-1']);
  });

  it('persists a Photo Blob round-trip', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    await db.photos.put({
      id: 'p-1',
      blob,
      width: 1280,
      height: 720,
      bytes: blob.size,
      mime: 'image/jpeg',
      created_at: NOW,
      deleted_at: null,
    });
    const read = await db.photos.get('p-1');
    expect(read?.bytes).toBe(blob.size);
    expect(read?.mime).toBe('image/jpeg');
    const buf = new Uint8Array(await read!.blob.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(bytes));
  });
});

describe('Variant type structural invariants (ADR-002)', () => {
  it('Variant has no quantity field — checked at compile time', () => {
    // If a future commit adds `quantity` to Variant, the line below will
    // stop typechecking, and `npm run typecheck` will fail.
    type HasQuantity = 'quantity' extends keyof Variant ? true : false;
    type _NoQuantityOnVariant = HasQuantity extends false ? 'ok' : never;
    const sentinel: _NoQuantityOnVariant = 'ok';
    expect(sentinel).toBe('ok');
  });
});
