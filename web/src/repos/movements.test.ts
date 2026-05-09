import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import {
  listMovementsForVariant,
  listRecentMovementsForArticle,
  reassignMovementVariant,
  recordMovement,
  revertMovement,
} from './movements';
import type { Variant } from '../types';

const NOW = '2026-05-07T00:00:00.000Z';

function mkVariant(o: Pick<Variant, 'id' | 'article_id' | 'size'>): Variant {
  return {
    color: 'black',
    photo_id: null,
    hidden: false,
    updated_at: NOW,
    deleted_at: null,
    ...o,
  };
}

describe('movements repo', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  describe('recordMovement — locationed types', () => {
    it('persists a sale with id, location, timestamps, and tombstone null', async () => {
      const m = await recordMovement(db, {
        variant_id: 'v-1',
        delta: -1,
        type: 'sale',
        location: 'floor',
      });
      expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(m.created_at).toBe(NOW);
      expect(m.deleted_at).toBeNull();
      expect(m.location).toBe('floor');
      expect(m.transfer_from).toBeNull();
      expect(m.transfer_to).toBeNull();
    });

    it('persists a damage write-off the same way as a sale (no revenue path)', async () => {
      const m = await recordMovement(db, {
        variant_id: 'v-1',
        delta: -1,
        type: 'damage',
        location: 'back',
      });
      expect(m.type).toBe('damage');
      expect(m.location).toBe('back');
    });

    it('rejects locationed types when location is missing', async () => {
      await expect(
        recordMovement(db, { variant_id: 'v-1', delta: -1, type: 'sale' }),
      ).rejects.toThrow(/location is required/);
      expect(await db.movements.count()).toBe(0);
    });

    it('rejects locationed types with transfer_from / transfer_to set', async () => {
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: -1,
          type: 'sale',
          location: 'floor',
          transfer_from: 'back',
          transfer_to: 'floor',
        }),
      ).rejects.toThrow(/transfer_from \/ transfer_to must be null/);
    });

    it('rejects delta = 0', async () => {
      await expect(
        recordMovement(db, { variant_id: 'v-1', delta: 0, type: 'sale', location: 'floor' }),
      ).rejects.toThrow(/non-zero/);
    });

    it('rejects non-integer delta', async () => {
      await expect(
        recordMovement(db, { variant_id: 'v-1', delta: 1.5, type: 'sale', location: 'floor' }),
      ).rejects.toThrow(/integer/);
    });
  });

  describe('recordMovement — transfer', () => {
    it('persists a transfer with the two endpoints, location null, positive delta', async () => {
      const m = await recordMovement(db, {
        variant_id: 'v-1',
        delta: 5,
        type: 'transfer',
        transfer_from: 'back',
        transfer_to: 'floor',
      });
      expect(m.type).toBe('transfer');
      expect(m.location).toBeNull();
      expect(m.transfer_from).toBe('back');
      expect(m.transfer_to).toBe('floor');
      expect(m.delta).toBe(5);
    });

    it('rejects transfer with location set', async () => {
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: 5,
          type: 'transfer',
          location: 'floor',
          transfer_from: 'back',
          transfer_to: 'floor',
        }),
      ).rejects.toThrow(/location must be null/);
    });

    it('rejects transfer missing transfer_from / transfer_to', async () => {
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: 5,
          type: 'transfer',
          transfer_to: 'floor',
        }),
      ).rejects.toThrow(/transfer_from and transfer_to are required/);
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: 5,
          type: 'transfer',
          transfer_from: 'back',
        }),
      ).rejects.toThrow(/transfer_from and transfer_to are required/);
    });

    it('rejects transfer where from === to', async () => {
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: 5,
          type: 'transfer',
          transfer_from: 'floor',
          transfer_to: 'floor',
        }),
      ).rejects.toThrow(/must differ/);
    });

    it('rejects transfer with negative delta (must be the absolute count moved)', async () => {
      await expect(
        recordMovement(db, {
          variant_id: 'v-1',
          delta: -1,
          type: 'transfer',
          transfer_from: 'back',
          transfer_to: 'floor',
        }),
      ).rejects.toThrow(/positive integer/);
    });
  });

  describe('revertMovement', () => {
    it('stamps deleted_at without touching delta or created_at (ADR-002)', async () => {
      const m = await recordMovement(db, {
        variant_id: 'v-1',
        delta: 5,
        type: 'purchase',
        location: 'back',
      });
      vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
      await revertMovement(db, m.id);
      const after = await db.movements.get(m.id);
      expect(after?.deleted_at).toBe('2026-05-08T00:00:00.000Z');
      expect(after?.delta).toBe(5);
      expect(after?.created_at).toBe(NOW);
    });

    it('throws on unknown id', async () => {
      await expect(revertMovement(db, 'nope')).rejects.toThrow(/no movement/i);
    });
  });

  describe('reassignMovementVariant', () => {
    it('updates variant_id and replaces the note', async () => {
      const m = await recordMovement(db, {
        variant_id: 'v-1',
        delta: -1,
        type: 'sale',
        location: 'floor',
        note: 'old note (migrated v5→v6; assigned to black — verify)',
      });
      await reassignMovementVariant(db, m.id, 'v-2', 'old note');
      const after = await db.movements.get(m.id);
      expect(after?.variant_id).toBe('v-2');
      expect(after?.note).toBe('old note');
    });

    it('throws on unknown id', async () => {
      await expect(reassignMovementVariant(db, 'nope', 'v-2', null)).rejects.toThrow(
        /no movement/i,
      );
    });
  });

  describe('listMovementsForVariant', () => {
    it('returns alive movements newest-first', async () => {
      await recordMovement(db, {
        variant_id: 'v-1',
        delta: 1,
        type: 'purchase',
        location: 'back',
      });
      vi.setSystemTime(new Date('2026-05-07T00:00:01.000Z'));
      const m2 = await recordMovement(db, {
        variant_id: 'v-1',
        delta: -1,
        type: 'sale',
        location: 'floor',
      });
      vi.setSystemTime(new Date('2026-05-07T00:00:02.000Z'));
      const m3 = await recordMovement(db, {
        variant_id: 'v-1',
        delta: 2,
        type: 'return',
        location: 'floor',
      });
      const out = await listMovementsForVariant(db, 'v-1');
      expect(out.map((m) => m.id)).toEqual([m3.id, m2.id, expect.any(String)]);
    });

    it('skips tombstoned rows', async () => {
      const m1 = await recordMovement(db, {
        variant_id: 'v-1',
        delta: 1,
        type: 'purchase',
        location: 'back',
      });
      await revertMovement(db, m1.id);
      expect((await listMovementsForVariant(db, 'v-1')).length).toBe(0);
    });

    it('respects the `since` lower bound', async () => {
      vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      await recordMovement(db, {
        variant_id: 'v-1',
        delta: 1,
        type: 'purchase',
        location: 'back',
      });
      vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
      const m2 = await recordMovement(db, {
        variant_id: 'v-1',
        delta: 1,
        type: 'purchase',
        location: 'back',
      });
      const recent = await listMovementsForVariant(db, 'v-1', {
        since: '2026-05-03T00:00:00.000Z',
      });
      expect(recent.map((m) => m.id)).toEqual([m2.id]);
    });

    it('respects `limit`', async () => {
      for (let i = 0; i < 5; i += 1) {
        vi.setSystemTime(new Date(`2026-05-07T00:00:0${i}.000Z`));
        await recordMovement(db, {
          variant_id: 'v-1',
          delta: 1,
          type: 'purchase',
          location: 'back',
        });
      }
      const out = await listMovementsForVariant(db, 'v-1', { limit: 2 });
      expect(out.length).toBe(2);
      expect(out[0]!.created_at > out[1]!.created_at).toBe(true);
    });
  });

  describe('listRecentMovementsForArticle', () => {
    it('aggregates movements across the article variants, newest first', async () => {
      await db.variants.bulkAdd([
        mkVariant({ id: 'v-1', article_id: 'a-1', size: '40' }),
        mkVariant({ id: 'v-2', article_id: 'a-1', size: '41' }),
        mkVariant({ id: 'v-other', article_id: 'a-2', size: '40' }),
      ]);
      vi.setSystemTime(new Date('2026-05-07T00:00:00.000Z'));
      await recordMovement(db, {
        variant_id: 'v-1',
        delta: 1,
        type: 'purchase',
        location: 'back',
      });
      vi.setSystemTime(new Date('2026-05-07T00:00:01.000Z'));
      const m2 = await recordMovement(db, {
        variant_id: 'v-2',
        delta: -1,
        type: 'sale',
        location: 'floor',
      });
      vi.setSystemTime(new Date('2026-05-07T00:00:02.000Z'));
      await recordMovement(db, {
        variant_id: 'v-other',
        delta: 9,
        type: 'purchase',
        location: 'back',
      });

      const out = await listRecentMovementsForArticle(db, 'a-1');
      expect(out.map((m) => m.id)).toEqual([m2.id, expect.any(String)]);
    });

    it('caps at the requested limit (default 8)', async () => {
      await db.variants.add(mkVariant({ id: 'v-1', article_id: 'a-1', size: '40' }));
      for (let i = 0; i < 10; i += 1) {
        vi.setSystemTime(new Date(`2026-05-07T00:00:0${i}.000Z`));
        await recordMovement(db, {
          variant_id: 'v-1',
          delta: 1,
          type: 'purchase',
          location: 'back',
        });
      }
      expect((await listRecentMovementsForArticle(db, 'a-1')).length).toBe(8);
      expect((await listRecentMovementsForArticle(db, 'a-1', 3)).length).toBe(3);
    });

    it('returns [] for an article with no variants', async () => {
      expect(await listRecentMovementsForArticle(db, 'a-1')).toEqual([]);
    });
  });
});
