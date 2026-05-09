import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import {
  colorSizeMatrix,
  quantityByLocation,
  quantityFor,
  quantityForLocation,
  sizeGridFor,
} from './quantity';
import type { Movement, Variant } from '../types';

const NOW = '2026-05-07T00:00:00.000Z';

function mkVariant(o: Partial<Variant> & Pick<Variant, 'id' | 'article_id' | 'size'>): Variant {
  return {
    color: 'black',
    photo_id: null,
    hidden: false,
    updated_at: NOW,
    deleted_at: null,
    ...o,
  };
}

function mkSale(
  o: Pick<Movement, 'id' | 'variant_id' | 'delta'> & { location: 'floor' | 'back' },
): Movement {
  return {
    type: 'sale',
    note: null,
    unit_price_tnd: null,
    location: o.location,
    transfer_from: null,
    transfer_to: null,
    created_at: NOW,
    deleted_at: null,
    id: o.id,
    variant_id: o.variant_id,
    delta: o.delta,
  };
}

function mkPurchase(
  o: Pick<Movement, 'id' | 'variant_id' | 'delta'> & { location: 'floor' | 'back' },
): Movement {
  return { ...mkSale(o), type: 'purchase' };
}

function mkTransfer(
  id: string,
  variant_id: string,
  delta: number,
  from: 'floor' | 'back',
  to: 'floor' | 'back',
): Movement {
  return {
    id,
    variant_id,
    delta,
    type: 'transfer',
    note: null,
    unit_price_tnd: null,
    location: null,
    transfer_from: from,
    transfer_to: to,
    created_at: NOW,
    deleted_at: null,
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

  it('sums signed deltas across alive movements (across both locations)', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 5, location: 'back' }),
      mkSale({ id: 'm2', variant_id: 'v-1', delta: -2, location: 'floor' }),
      { ...mkSale({ id: 'm3', variant_id: 'v-1', delta: 3, location: 'floor' }), type: 'return' },
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(6);
  });

  it('excludes tombstoned (reverted) movements', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 5, location: 'back' }),
      {
        ...mkSale({ id: 'm2', variant_id: 'v-1', delta: -10, location: 'floor' }),
        deleted_at: NOW,
      },
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(5);
  });

  it('isolates variants from each other', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 5, location: 'back' }),
      mkPurchase({ id: 'm2', variant_id: 'v-2', delta: 99, location: 'back' }),
    ]);
    expect(await quantityFor(db, 'v-1')).toBe(5);
  });
});

describe('quantityForLocation / quantityByLocation', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('splits stock between floor and back per movement.location', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 35, location: 'back' }),
      mkPurchase({ id: 'm2', variant_id: 'v-1', delta: 5, location: 'floor' }),
      mkSale({ id: 'm3', variant_id: 'v-1', delta: -1, location: 'floor' }),
    ]);
    expect(await quantityByLocation(db, 'v-1')).toEqual({ floor: 4, back: 35 });
    expect(await quantityForLocation(db, 'v-1', 'floor')).toBe(4);
    expect(await quantityForLocation(db, 'v-1', 'back')).toBe(35);
    expect(await quantityFor(db, 'v-1')).toBe(39);
  });

  it('transfers move stock between locations without touching the total', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 10, location: 'back' }),
      mkTransfer('t1', 'v-1', 4, 'back', 'floor'),
    ]);
    expect(await quantityByLocation(db, 'v-1')).toEqual({ floor: 4, back: 6 });
    expect(await quantityFor(db, 'v-1')).toBe(10);
  });

  it('damage write-offs reduce stock in the recorded location', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 10, location: 'floor' }),
      {
        ...mkSale({ id: 'm2', variant_id: 'v-1', delta: -1, location: 'floor' }),
        type: 'damage',
      },
    ]);
    expect(await quantityByLocation(db, 'v-1')).toEqual({ floor: 9, back: 0 });
  });

  it('tombstoned transfers do not move stock', async () => {
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-1', delta: 10, location: 'back' }),
      { ...mkTransfer('t1', 'v-1', 4, 'back', 'floor'), deleted_at: NOW },
    ]);
    expect(await quantityByLocation(db, 'v-1')).toEqual({ floor: 0, back: 10 });
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

  it('returns one cell per alive variant, with floor + back broken out', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v-41', article_id: 'a-1', size: '41' }),
      mkVariant({ id: 'v-39', article_id: 'a-1', size: '39' }),
      mkVariant({ id: 'v-40', article_id: 'a-1', size: '40' }),
    ]);
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v-39', delta: 2, location: 'back' }),
      mkPurchase({ id: 'm2', variant_id: 'v-40', delta: 4, location: 'back' }),
      mkSale({ id: 'm3', variant_id: 'v-40', delta: -1, location: 'back' }),
    ]);

    const grid = await sizeGridFor(db, 'a-1');
    expect(grid.map((c) => c.size)).toEqual(['39', '40', '41']);
    expect(grid.map((c) => c.qty)).toEqual([2, 3, 0]);
    expect(grid.find((c) => c.size === '40')?.back).toBe(3);
    expect(grid.find((c) => c.size === '40')?.floor).toBe(0);
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

describe('colorSizeMatrix', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('builds a rows × columns grid with synthetic empty cells for missing pairs', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v1', article_id: 'a-1', size: '40', color: 'black' }),
      mkVariant({ id: 'v2', article_id: 'a-1', size: '41', color: 'black' }),
      // No (yellow, 41) variant — that cell should be synthesised empty.
      mkVariant({ id: 'v3', article_id: 'a-1', size: '40', color: 'yellow' }),
    ]);
    await db.movements.bulkAdd([
      mkPurchase({ id: 'm1', variant_id: 'v1', delta: 5, location: 'back' }),
    ]);

    const matrix = await colorSizeMatrix(db, 'a-1');
    expect(matrix.sizes).toEqual(['40', '41']);
    expect(matrix.rows.map((r) => r.color)).toEqual(['black', 'yellow']);
    expect(matrix.rows[0]!.cells.map((c) => c.qty)).toEqual([5, 0]);
    // The synthesised yellow/41 cell has no variant_id so the UI knows
    // it's a placeholder (not tappable).
    const synthetic = matrix.rows[1]!.cells[1]!;
    expect(synthetic.variant_id).toBe('');
    expect(synthetic.qty).toBe(0);
  });

  it('groups colourless variants under a single null-colour row', async () => {
    await db.variants.bulkAdd([
      mkVariant({ id: 'v1', article_id: 'a-1', size: null, color: null }),
    ]);
    const matrix = await colorSizeMatrix(db, 'a-1');
    expect(matrix.rows.length).toBe(1);
    expect(matrix.rows[0]!.color).toBeNull();
  });
});
