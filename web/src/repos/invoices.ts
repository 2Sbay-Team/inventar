import { type InventarDB } from '../db/db';
import { type Invoice, type InvoiceLine, type CurrencyCode, type UUID } from '../types';
import { newUUID } from '../utils/uuid';
import { nowISO } from '../utils/now';
import { META_KEYS } from './meta';

// v0.5.2.4 ADR-024 — Invoice (Facture) issuance.
//
// Numbering: per-year sequential, format `INV-{YYYY}-{NNNN}`. The
// counter is stored as a {[year]: nextNumber} map in
// meta.invoice_counter so a new year starts at 0001 without losing the
// prior year's next-number state. Atomic increment lives in the same
// Dexie transaction as the invoices.put so there's no race window
// where two parallel issuances could collide on the same number.
//
// Snapshot semantics: every numeric and label on Invoice is frozen at
// issue time (ADR-024). The caller computes subtotal_minor / vat_minor
// / total_minor from the cart it has on hand, we don't recompute on
// read. Article renames and price changes after the fact never mutate
// already-issued invoices.

type CounterMap = Record<string, number>;

function isCounterMap(value: unknown): value is CounterMap {
  if (!value || typeof value !== 'object') return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(k)) return false;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return false;
  }
  return true;
}

// Reads the per-year counter map from meta and bumps the chosen year's
// counter by 1, returning the freshly-allocated next-number. MUST be
// called inside a tx that also writes the resulting Invoice — running
// outside one risks burning numbers on a write that fails downstream.
async function allocateInvoiceNumber(db: InventarDB, year: string): Promise<number> {
  const row = await db.meta.get(META_KEYS.invoice_counter);
  const existing: CounterMap = isCounterMap(row?.value) ? row.value : {};
  const next = (existing[year] ?? 0) + 1;
  const updated: CounterMap = { ...existing, [year]: next };
  await db.meta.put({ key: META_KEYS.invoice_counter, value: updated });
  return next;
}

function formatNumber(year: string, n: number): string {
  return `INV-${year}-${String(n).padStart(4, '0')}`;
}

export interface CreateInvoiceInput {
  // The Sell session's transaction_id when the invoice is generated
  // alongside a sale. Null for manually-issued invoices (no movement
  // record on the books).
  transaction_id: UUID | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_fiscal_id: string | null;
  lines: InvoiceLine[];
  currency: CurrencyCode;
  // Integer percent (0-50). The caller (commitSale) reads
  // ShopProfile.default_vat_pct and lets the merchant override per
  // invoice; when neither is set, pass 0.
  vat_pct: number;
  notes: string | null;
}

// Computes subtotal/vat/total snapshots from the lines + vat rate.
// Banker's rounding isn't important here — millimes are the smallest
// unit and we round to the nearest whole one. `Math.round` matches
// what the merchant expects when they read totals on paper.
export function computeInvoiceTotals(
  lines: InvoiceLine[],
  vatPct: number,
): { subtotal_minor: number; vat_minor: number; total_minor: number } {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price_minor, 0);
  const vat = Math.round((subtotal * vatPct) / 100);
  return { subtotal_minor: subtotal, vat_minor: vat, total_minor: subtotal + vat };
}

export async function createInvoice(db: InventarDB, input: CreateInvoiceInput): Promise<Invoice> {
  const ts = nowISO();
  const year = ts.slice(0, 4);
  const totals = computeInvoiceTotals(input.lines, input.vat_pct);
  return db.transaction('rw', [db.invoices, db.meta], async () => {
    const seq = await allocateInvoiceNumber(db, year);
    const invoice: Invoice = {
      id: newUUID(),
      number: formatNumber(year, seq),
      issued_at: ts,
      customer_name: input.customer_name,
      customer_address: input.customer_address,
      customer_fiscal_id: input.customer_fiscal_id,
      lines: input.lines,
      currency: input.currency,
      subtotal_minor: totals.subtotal_minor,
      vat_pct: input.vat_pct,
      vat_minor: totals.vat_minor,
      total_minor: totals.total_minor,
      notes: input.notes,
      transaction_id: input.transaction_id,
      created_at: ts,
      deleted_at: null,
    };
    await db.invoices.add(invoice);
    return invoice;
  });
}

export async function getInvoice(db: InventarDB, id: UUID): Promise<Invoice | undefined> {
  return db.invoices.get(id);
}

export async function listInvoices(db: InventarDB): Promise<Invoice[]> {
  return db.invoices
    .orderBy('issued_at')
    .reverse()
    .filter((i) => i.deleted_at === null)
    .toArray();
}
