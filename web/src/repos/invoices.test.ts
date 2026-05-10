import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { computeInvoiceTotals, createInvoice, getInvoice, listInvoices } from './invoices';
import { getMeta, META_KEYS } from './meta';

// vi.useFakeTimers() interferes with Dexie's microtask scheduling so we
// stub only Date.now() / Date constructor explicitly. nowISO() reads
// new Date().toISOString() so this gives us deterministic YYYY/dates
// without breaking IDB.
function freezeDate(iso: string): () => void {
  const fixed = new Date(iso).valueOf();
  const RealDate = Date;
  const RealNow = Date.now;
  // Constructor wrapper that uses the fixed time when called with no
  // args; defers to the real Date for parsed/passed args. Cast through
  // unknown so TS lets us swap the constructor at runtime.
  function FakeDate(this: unknown, ...args: unknown[]): Date {
    if (args.length === 0) return new RealDate(fixed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (RealDate as any)(...args);
  }
  FakeDate.now = (): number => fixed;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (FakeDate as any).prototype = RealDate.prototype;
  (globalThis as unknown as { Date: typeof Date }).Date = FakeDate as unknown as typeof Date;
  return () => {
    (globalThis as unknown as { Date: typeof Date }).Date = RealDate;
    Date.now = RealNow;
  };
}

describe('invoices repo (ADR-024)', () => {
  let db: InventarDB;
  let restoreDate: (() => void) | null = null;

  beforeEach(async () => {
    restoreDate = freezeDate('2026-05-10T10:00:00.000Z');
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    restoreDate?.();
    restoreDate = null;
    vi.useRealTimers();
  });

  describe('computeInvoiceTotals', () => {
    it('subtotal = sum(qty * unit_price); vat = round(subtotal * pct / 100)', () => {
      const totals = computeInvoiceTotals(
        [
          { description: 'A', reference: null, qty: 2, unit_price_minor: 12_500 },
          { description: 'B', reference: null, qty: 1, unit_price_minor: 7_500 },
        ],
        19,
      );
      // 2 * 12_500 + 1 * 7_500 = 32_500
      expect(totals.subtotal_minor).toBe(32_500);
      // 32_500 * 0.19 = 6_175 (exact)
      expect(totals.vat_minor).toBe(6_175);
      expect(totals.total_minor).toBe(38_675);
    });

    it('vat_pct = 0 → vat_minor = 0, total = subtotal', () => {
      const totals = computeInvoiceTotals(
        [{ description: 'X', reference: null, qty: 1, unit_price_minor: 1_000 }],
        0,
      );
      expect(totals.vat_minor).toBe(0);
      expect(totals.total_minor).toBe(1_000);
    });

    it('rounds vat to nearest minor unit (no fractional millimes)', () => {
      // 1_000 * 19 / 100 = 190 exactly — no rounding needed
      // 1_001 * 19 / 100 = 190.19 → rounds to 190
      const totals = computeInvoiceTotals(
        [{ description: 'X', reference: null, qty: 1, unit_price_minor: 1_001 }],
        19,
      );
      expect(totals.vat_minor).toBe(190);
      expect(totals.total_minor).toBe(1_191);
    });

    it('empty lines → all zero', () => {
      const totals = computeInvoiceTotals([], 19);
      expect(totals.subtotal_minor).toBe(0);
      expect(totals.vat_minor).toBe(0);
      expect(totals.total_minor).toBe(0);
    });
  });

  describe('createInvoice', () => {
    it('first invoice of the year gets INV-{YYYY}-0001', async () => {
      const inv = await createInvoice(db, {
        transaction_id: null,
        customer_name: 'Walk-in',
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'Item', reference: null, qty: 1, unit_price_minor: 1_000 }],
        currency: 'TND',
        vat_pct: 19,
        notes: null,
      });
      expect(inv.number).toBe('INV-2026-0001');
      expect(inv.subtotal_minor).toBe(1_000);
      expect(inv.vat_minor).toBe(190);
      expect(inv.total_minor).toBe(1_190);
    });

    it('subsequent invoices increment within the same year', async () => {
      const a = await createInvoice(db, {
        transaction_id: null,
        customer_name: null,
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'X', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      const b = await createInvoice(db, {
        transaction_id: null,
        customer_name: null,
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'Y', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      const c = await createInvoice(db, {
        transaction_id: null,
        customer_name: null,
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'Z', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      expect(a.number).toBe('INV-2026-0001');
      expect(b.number).toBe('INV-2026-0002');
      expect(c.number).toBe('INV-2026-0003');
    });

    it('counter rolls over per calendar year (each year starts at 0001)', async () => {
      restoreDate?.();
      restoreDate = freezeDate('2026-12-31T23:00:00.000Z');
      const last2026 = await createInvoice(db, {
        transaction_id: null,
        customer_name: null,
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'X', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      restoreDate?.();
      restoreDate = freezeDate('2027-01-01T00:30:00.000Z');
      const first2027 = await createInvoice(db, {
        transaction_id: null,
        customer_name: null,
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'Y', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      expect(last2026.number).toBe('INV-2026-0001');
      expect(first2027.number).toBe('INV-2027-0001');
      // Both years should be persisted in the counter map.
      const counter = await getMeta<Record<string, number>>(db, META_KEYS.invoice_counter);
      expect(counter).toEqual({ '2026': 1, '2027': 1 });
    });

    it('persists every snapshot field and reads back identical', async () => {
      const inv = await createInvoice(db, {
        transaction_id: 'tx-xyz',
        customer_name: 'ACME Co',
        customer_address: '1 rue X\n2000 Sousse',
        customer_fiscal_id: '9876543/Z/Z/000',
        lines: [
          { description: 'Item A', reference: 'SP-0001', qty: 2, unit_price_minor: 12_500 },
          { description: 'Item B', reference: null, qty: 1, unit_price_minor: 7_500 },
        ],
        currency: 'TND',
        vat_pct: 19,
        notes: 'Thanks for your business',
      });
      const read = await getInvoice(db, inv.id);
      expect(read).toEqual(inv);
      expect(read?.lines.length).toBe(2);
      expect(read?.subtotal_minor).toBe(32_500);
      expect(read?.vat_minor).toBe(6_175);
      expect(read?.total_minor).toBe(38_675);
      expect(read?.transaction_id).toBe('tx-xyz');
    });
  });

  describe('listInvoices', () => {
    it('returns non-deleted invoices in reverse chronological order', async () => {
      restoreDate?.();
      restoreDate = freezeDate('2026-05-08T10:00:00.000Z');
      await createInvoice(db, {
        transaction_id: null,
        customer_name: 'first',
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'a', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      restoreDate?.();
      restoreDate = freezeDate('2026-05-09T10:00:00.000Z');
      await createInvoice(db, {
        transaction_id: null,
        customer_name: 'second',
        customer_address: null,
        customer_fiscal_id: null,
        lines: [{ description: 'b', reference: null, qty: 1, unit_price_minor: 100 }],
        currency: 'TND',
        vat_pct: 0,
        notes: null,
      });
      const list = await listInvoices(db);
      expect(list.map((i) => i.customer_name)).toEqual(['second', 'first']);
    });
  });
});
