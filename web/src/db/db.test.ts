import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from './db';
import type { Variant } from '../types';

describe('InventarDB schema (v6)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('opens at version 6', () => {
    expect(db.verno).toBe(6);
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

  it('articles: primKey id + the v6 indexes (no more multi-entry *colors)', () => {
    const t = db.table('articles');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      'archived_at',
      'category',
      'deleted_at',
      'internal_code',
      'search_blob',
      'updated_at',
    ]);
    // Multi-entry colour index from v1–v5 must be gone — colour lives on
    // Variant after ADR-011, so any survivor here is a migration bug.
    expect(indexNames.includes('colors')).toBe(false);
  });

  it('variants: primKey id + compound [article_id+size] AND [article_id+color+size]', () => {
    const t = db.table('variants');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      '[article_id+color+size]',
      '[article_id+size]',
      'article_id',
      'deleted_at',
    ]);
    const tri = t.schema.indexes.find((i) => i.name === '[article_id+color+size]');
    expect(tri?.compound).toBe(true);
    expect(tri?.keyPath).toEqual(['article_id', 'color', 'size']);
  });

  it('movements: primKey id + per-location compound for the activity feed', () => {
    const t = db.table('movements');
    expect(t.schema.primKey.name).toBe('id');
    const indexNames = t.schema.indexes.map((i) => i.name).sort();
    expect(indexNames).toEqual([
      '[variant_id+created_at]',
      '[variant_id+location+created_at]',
      'created_at',
      'deleted_at',
      'type',
      'variant_id',
    ]);
    const triple = t.schema.indexes.find((i) => i.name === '[variant_id+location+created_at]');
    expect(triple?.compound).toBe(true);
    expect(triple?.keyPath).toEqual(['variant_id', 'location', 'created_at']);
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

describe('InventarDB CRUD smoke (v6)', () => {
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

  it('queries variants by [article_id+color+size] compound index', async () => {
    const articleId = 'a-1';
    await db.variants.bulkAdd([
      {
        id: 'v-bk-39',
        article_id: articleId,
        color: 'black',
        size: '39',
        photo_id: null,
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
      {
        id: 'v-bk-40',
        article_id: articleId,
        color: 'black',
        size: '40',
        photo_id: null,
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
      {
        id: 'v-yl-40',
        article_id: articleId,
        color: 'yellow',
        size: '40',
        photo_id: null,
        hidden: false,
        updated_at: NOW,
        deleted_at: null,
      },
    ]);
    const blackForty = await db.variants
      .where('[article_id+color+size]')
      .equals([articleId, 'black', '40'])
      .first();
    expect(blackForty?.id).toBe('v-bk-40');
    const yellowForty = await db.variants
      .where('[article_id+color+size]')
      .equals([articleId, 'yellow', '40'])
      .first();
    expect(yellowForty?.id).toBe('v-yl-40');
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
      location: 'back',
      transfer_from: null,
      transfer_to: null,
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

describe('Variant type structural invariants (ADR-002 + ADR-011)', () => {
  it('Variant has no quantity field — checked at compile time', () => {
    type HasQuantity = 'quantity' extends keyof Variant ? true : false;
    type _NoQuantityOnVariant = HasQuantity extends false ? 'ok' : never;
    const sentinel: _NoQuantityOnVariant = 'ok';
    expect(sentinel).toBe('ok');
  });

  it('Variant carries color and photo_id — ADR-011 / ADR-013', () => {
    type HasColor = 'color' extends keyof Variant ? true : false;
    type HasPhoto = 'photo_id' extends keyof Variant ? true : false;
    const c: HasColor = true;
    const p: HasPhoto = true;
    expect(c).toBe(true);
    expect(p).toBe(true);
  });
});
