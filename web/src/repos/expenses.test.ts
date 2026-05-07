import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { addExpense, listExpenses, softDeleteExpense, updateExpense } from './expenses';

const NOW = '2026-05-07T00:00:00.000Z';

describe('expenses repo', () => {
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

  describe('addExpense', () => {
    it('persists an expense with timestamps', async () => {
      const e = await addExpense(db, {
        category: 'rent',
        amount_tnd: 500000,
        note: null,
        at: '2026-05-07T08:00:00.000Z',
        recurring: 'monthly',
      });
      expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(e.amount_tnd).toBe(500000);
      expect(e.updated_at).toBe(NOW);
      expect(e.deleted_at).toBeNull();
    });

    it('rejects non-positive amounts (SPEC §6)', async () => {
      const base = {
        category: 'rent' as const,
        note: null,
        at: NOW,
        recurring: 'none' as const,
      };
      await expect(addExpense(db, { ...base, amount_tnd: 0 })).rejects.toThrow(/> 0/);
      await expect(addExpense(db, { ...base, amount_tnd: -1 })).rejects.toThrow(/> 0/);
    });

    it('rejects non-integer amounts (ADR-005 millimes)', async () => {
      await expect(
        addExpense(db, {
          category: 'rent',
          amount_tnd: 12.5,
          note: null,
          at: NOW,
          recurring: 'none',
        }),
      ).rejects.toThrow(/integer/);
    });
  });

  describe('updateExpense', () => {
    it('merges fields and bumps updated_at', async () => {
      const e = await addExpense(db, {
        category: 'rent',
        amount_tnd: 500000,
        note: null,
        at: NOW,
        recurring: 'monthly',
      });
      vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
      const after = await updateExpense(db, e.id, { amount_tnd: 510000, note: 'increase' });
      expect(after.amount_tnd).toBe(510000);
      expect(after.note).toBe('increase');
      expect(after.category).toBe('rent');
      expect(after.updated_at).toBe('2026-05-08T00:00:00.000Z');
    });

    it('rejects deleted rows', async () => {
      const e = await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: NOW,
        recurring: 'none',
      });
      await softDeleteExpense(db, e.id);
      await expect(updateExpense(db, e.id, { amount_tnd: 2 })).rejects.toThrow(/deleted/);
    });

    it('throws on unknown id', async () => {
      await expect(updateExpense(db, 'nope', { amount_tnd: 1 })).rejects.toThrow(/no expense/i);
    });
  });

  describe('listExpenses', () => {
    it('returns alive rows, newest first by `at`', async () => {
      const e1 = await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: '2026-05-01T00:00:00.000Z',
        recurring: 'none',
      });
      const e2 = await addExpense(db, {
        category: 'electricity',
        amount_tnd: 1,
        note: null,
        at: '2026-05-05T00:00:00.000Z',
        recurring: 'none',
      });
      const e3 = await addExpense(db, {
        category: 'internet',
        amount_tnd: 1,
        note: null,
        at: '2026-05-03T00:00:00.000Z',
        recurring: 'none',
      });
      await softDeleteExpense(db, e1.id);

      const out = await listExpenses(db);
      expect(out.map((e) => e.id)).toEqual([e2.id, e3.id]);
    });

    it('windows by half-open [from, to) on `at`', async () => {
      await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: '2026-05-01T00:00:00.000Z',
        recurring: 'none',
      });
      const inWindow = await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: '2026-05-05T00:00:00.000Z',
        recurring: 'none',
      });
      // boundary row sits exactly on `to` and must be excluded.
      await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: '2026-05-08T00:00:00.000Z',
        recurring: 'none',
      });

      const out = await listExpenses(db, {
        from: '2026-05-02T00:00:00.000Z',
        to: '2026-05-08T00:00:00.000Z',
      });
      expect(out.map((e) => e.id)).toEqual([inWindow.id]);
    });

    it('filters by category', async () => {
      await addExpense(db, {
        category: 'rent',
        amount_tnd: 1,
        note: null,
        at: NOW,
        recurring: 'none',
      });
      const elec = await addExpense(db, {
        category: 'electricity',
        amount_tnd: 1,
        note: null,
        at: NOW,
        recurring: 'none',
      });
      const out = await listExpenses(db, { category: 'electricity' });
      expect(out.map((e) => e.id)).toEqual([elec.id]);
    });
  });
});
