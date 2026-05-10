import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { createLot, pickFifoLot, remainingForLot } from './lots';
import { recordMovement } from './movements';
import type { Variant } from '../types';

const NOW = '2026-05-07T00:00:00.000Z';

function mkVariant(): Variant {
  return {
    id: 'v1',
    article_id: 'a1',
    color: null,
    size: null,
    photo_id: null,
    hidden: false,
    updated_at: NOW,
    deleted_at: null,
  };
}

describe('lots repo', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    db = new InventarDB();
    await db.open();
    await db.variants.add(mkVariant());
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  describe('remainingForLot', () => {
    it('returns original_quantity when no sales attribute to the lot', async () => {
      const purchase = await recordMovement(db, {
        variant_id: 'v1',
        delta: 8,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lot = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 8,
        source_movement_id: purchase.id,
      });
      expect(await remainingForLot(db, lot.id)).toBe(8);
    });

    it('subtracts sale movements that point at this lot', async () => {
      const purchase = await recordMovement(db, {
        variant_id: 'v1',
        delta: 8,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lot = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 8,
        source_movement_id: purchase.id,
      });
      await recordMovement(db, {
        variant_id: 'v1',
        delta: -3,
        type: 'sale',
        location: 'floor',
        lot_id: lot.id,
      });
      expect(await remainingForLot(db, lot.id)).toBe(5);
    });

    it('credits returns whose linked sale was attributed to this lot', async () => {
      // Setup: 8 units in Lot A, sell 3 from it, then return 1 of those.
      // Expected remaining: 8 − 3 + 1 = 6.
      const purchase = await recordMovement(db, {
        variant_id: 'v1',
        delta: 8,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lot = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 8,
        source_movement_id: purchase.id,
      });
      const sale = await recordMovement(db, {
        variant_id: 'v1',
        delta: -3,
        type: 'sale',
        location: 'floor',
        lot_id: lot.id,
      });
      await recordMovement(db, {
        variant_id: 'v1',
        delta: 1,
        type: 'return',
        location: 'floor',
        refunds_movement_id: sale.id,
      });
      expect(await remainingForLot(db, lot.id)).toBe(6);
    });

    it('does NOT credit returns whose linked sale belongs to a different lot', async () => {
      // Two lots: A (5 units, exp May 15) and B (10 units, exp May 22).
      // Sell 1 from A and 1 from B; return the B sale. A's remaining
      // stays at 4 — A doesn't get the refunded unit because its source
      // wasn't B's sale.
      const purchaseA = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lotA = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: purchaseA.id,
      });
      const purchaseB = await recordMovement(db, {
        variant_id: 'v1',
        delta: 10,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-22T00:00:00.000Z',
      });
      const lotB = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-22T00:00:00.000Z',
        original_quantity: 10,
        source_movement_id: purchaseB.id,
      });
      await recordMovement(db, {
        variant_id: 'v1',
        delta: -1,
        type: 'sale',
        location: 'floor',
        lot_id: lotA.id,
      });
      const saleB = await recordMovement(db, {
        variant_id: 'v1',
        delta: -1,
        type: 'sale',
        location: 'floor',
        lot_id: lotB.id,
      });
      await recordMovement(db, {
        variant_id: 'v1',
        delta: 1,
        type: 'return',
        location: 'floor',
        refunds_movement_id: saleB.id,
      });
      expect(await remainingForLot(db, lotA.id)).toBe(4);
      expect(await remainingForLot(db, lotB.id)).toBe(10); // sold 1 + returned 1
    });

    it('ignores returns with no refunds_movement_id (legacy / Quick Adjust without link)', async () => {
      // A return that doesn't link back to a sale can't be credited
      // to any specific lot. The return still adjusts variant total
      // stock (via quantityFor); it just doesn't restore lot accounting.
      const purchase = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lot = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: purchase.id,
      });
      await recordMovement(db, {
        variant_id: 'v1',
        delta: -2,
        type: 'sale',
        location: 'floor',
        lot_id: lot.id,
      });
      // Unlinked return — no refunds_movement_id.
      await recordMovement(db, {
        variant_id: 'v1',
        delta: 1,
        type: 'return',
        location: 'floor',
      });
      expect(await remainingForLot(db, lot.id)).toBe(3); // 5 sold 2, return doesn't credit
    });

    it('returns 0 for tombstoned lots', async () => {
      const purchase = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const lot = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: purchase.id,
      });
      await db.lots.update(lot.id, { deleted_at: NOW });
      expect(await remainingForLot(db, lot.id)).toBe(0);
    });
  });

  describe('pickFifoLot', () => {
    it('picks the earliest-expiring alive lot with remaining > 0', async () => {
      const pA = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const pB = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-22T00:00:00.000Z',
      });
      const lotA = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: pA.id,
      });
      await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-22T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: pB.id,
      });
      const picked = await pickFifoLot(db, 'v1');
      expect(picked?.id).toBe(lotA.id);
    });

    it('skips lots with remaining = 0 and returns the next earliest', async () => {
      const pA = await recordMovement(db, {
        variant_id: 'v1',
        delta: 2,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-15T00:00:00.000Z',
      });
      const pB = await recordMovement(db, {
        variant_id: 'v1',
        delta: 5,
        type: 'purchase',
        location: 'back',
        expires_at: '2026-05-22T00:00:00.000Z',
      });
      const lotA = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-15T00:00:00.000Z',
        original_quantity: 2,
        source_movement_id: pA.id,
      });
      const lotB = await createLot(db, {
        variant_id: 'v1',
        expires_at: '2026-05-22T00:00:00.000Z',
        original_quantity: 5,
        source_movement_id: pB.id,
      });
      // Drain Lot A.
      await recordMovement(db, {
        variant_id: 'v1',
        delta: -2,
        type: 'sale',
        location: 'floor',
        lot_id: lotA.id,
      });
      const picked = await pickFifoLot(db, 'v1');
      expect(picked?.id).toBe(lotB.id);
    });
  });
});
