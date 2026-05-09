import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { quantityFor, sizeGridFor } from './quantity';
import type { Movement, Variant } from '../types';

const NOW = '2026-05-07T00:00:00.000Z';

function mkVariant(o: Partial<Variant> & Pick<Variant, 'id' | 'article_id' | 'size'>): Variant {
  return { hidden: false, updated_at: NOW, deleted_at: null, ...o };
}

function mkMovement(
  o: Partial<Movement> & Pick<Movement, 'id' | 'variant_id' | 'delta'>,
): Movement {
  return {
    type: 'purchase',
    note: null,
    unit_price_tnd: null,
    created_at: NOW,
    deleted_at: null,
    ...o,
  };
}

describe('quantityFor', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('returns 0 for a variant with no movements', async () => {
    expect(await quantityFor(db, 'v-empty')).toBe(0);
  });

  it('sums signed deltas across alive movements', async () => {
    await db.movements.bulkAdd([
      mkMovement({ id: 'm1', variant_id: 'v-1', delta: 5 }),
      mkMovement({ id: 'm2', variant_id: 'v-1', delta: -2, type: 'sale' }),
      mkMovement({ id: 'm3', variant_id: 'v-1', delta: 3, type: 'return' }),
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(6);
  });

  it('excludes tombstoned (reverted) movements', async () => {
    await db.movements.bulkAdd([
      mkMovement({ id: 'm1', variant_id: 'v-1', delta: 5 }),
      mkMovement({ id: 'm2', variant_id: 'v-1', delta: -10, type: 'sale', deleted_at: NOW }),
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(5);
  });

  it('isolates variants from each other', async () => {
    await db.movements.bulkAdd([
      mkMovement({ id: 'm1', variant_id: 'v-1', delta: 5 }),
      mkMovement({ id: 'm2', variant_id: 'v-2', delta: 99 }),
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(5);
  });
});

describe('sizeGridFor', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('returns one cell per alive variant, sorted by size', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v-41', article_id: 'a-1', size: '41' }),
      mkVariant({ id: 'v-39', article_id: 'a-1', size: '39' }),
      mkVariant({ id: 'v-40', article_id: 'a-1', size: '40' }),
    ]);
    await db.movements.bulkAdd([
      mkMovement({ id: 'm1', variant_id: 'v-39', delta: 2 }),
      mkMovement({ id: 'm2', variant_id: 'v-40', delta: 0 + 4 }),
      mkMovement({ id: 'm3', variant_id: 'v-40', delta: -1, type: 'sale' }),
    ]);

    const grid = await sizeGridFor(db, 'a-1');
    expect(grid.map((c) => c.size)).toEqual(['39', '40', '41']);
    expect(grid.map((c) => c.qty)).toEqual([2, 3, 0]);
    expect(grid.every((c) => c.hidden === false)).toBe(true);
  });

  it('excludes soft-deleted variants but keeps hidden ones flagged', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v-1', article_id: 'a-1', size: 'A', deleted_at: NOW }),
      mkVariant({ id: 'v-2', article_id: 'a-1', size: 'B', hidden: true }),
      mkVariant({ id: 'v-3', article_id: 'a-1', size: 'C' }),
    ]);
    const grid = await sizeGridFor(db, 'a-1');
    expect(grid.map((c) => c.size)).toEqual(['B', 'C']);
    expect(grid.find((c) => c.size === 'B')?.hidden).toBe(true);
    expect(grid.find((c) => c.size === 'C')?.hidden).toBe(false);
  });

  it('does not leak variants from other articles', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v-1', article_id: 'a-1', size: '40' }),
      mkVariant({ id: 'v-2', article_id: 'a-2', size: '40' }),
    ]);
    const grid = await sizeGridFor(db, 'a-1');
    expect(grid.map((c) => c.variant_id)).toEqual(['v-1']);
  });
});
