import { type InventarDB } from '../db/db';
import {
  type Invoice,
  type InvoiceLine,
  type InvoicePaymentStatus,
  type CurrencyCode,
  type ISODate,
  type UUID,
} from '../types';
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
// issue time (ADR-024). Article renames and price changes after the fact
// never mutate already-issued invoices.
//
// v1.2 adds structured payment/debt fields. Dashboard cash now reads
// `paid_minor`; customer debt reads `balance_due_minor`. Older imported
// rows are treated as paid in full by the schema/import backfills.

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

export type CreateInvoicePaymentMode = 'paid' | 'partial' | 'unpaid';

export interface CreateInvoiceInput {
  // The Sell session's transaction_id when the invoice is generated
  // alongside a sale. Null for manually-issued invoices (no movement
  // record on the books).
  transaction_id: UUID | null;
  customer_id?: UUID | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_fiscal_id: string | null;
  lines: InvoiceLine[];
  currency: CurrencyCode;
  // Integer percent (0-50). The caller (commitSale) reads
  // ShopProfile.default_vat_pct and lets the merchant override per
  // invoice; when neither is set, pass 0.
  vat_pct: number;
  // v0.5.2.7 — optional VAT switch. When false, computeInvoiceTotals
  // zeroes the VAT amount regardless of vat_pct (so total = subtotal),
  // and downstream renderers (PDF + screen) skip the VAT line.
  // Defaults to true for back-compat with callers that don't pass it.
  vat_enabled?: boolean;
  // v1.2 — initial payment state at issue time. For `partial`, pass the
  // amount actually received in paid_minor. The repository normalises
  // edge cases: partial 0 becomes unpaid; partial >= total becomes paid.
  payment_mode?: CreateInvoicePaymentMode;
  paid_minor?: number;
  due_at?: ISODate | null;
  notes: string | null;
}

// Computes subtotal/vat/total snapshots from the lines + vat rate.
// Banker's rounding isn't important here — millimes are the smallest
// unit and we round to the nearest whole one. `Math.round` matches
// what the merchant expects when they read totals on paper.
export function computeInvoiceTotals(
  lines: InvoiceLine[],
  vatPct: number,
  vatEnabled: boolean = true,
): { subtotal_minor: number; vat_minor: number; total_minor: number } {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unit_price_minor, 0);
  // When VAT is disabled (e.g. exempt sale, B2B with reverse charge,
  // merchant not VAT-registered) we zero the VAT amount so total =
  // subtotal regardless of the stored vat_pct.
  const vat = vatEnabled ? Math.round((subtotal * vatPct) / 100) : 0;
  return { subtotal_minor: subtotal, vat_minor: vat, total_minor: subtotal + vat };
}

export function computeInvoicePayment(input: {
  total_minor: number;
  mode: CreateInvoicePaymentMode;
  paid_minor?: number | null;
}): { payment_status: InvoicePaymentStatus; paid_minor: number; balance_due_minor: number } {
  const total = Math.max(0, Math.round(input.total_minor));
  if (total === 0 || input.mode === 'paid') {
    return { payment_status: 'paid', paid_minor: total, balance_due_minor: 0 };
  }
  if (input.mode === 'unpaid') {
    return { payment_status: 'unpaid', paid_minor: 0, balance_due_minor: total };
  }
  const rawPaid = Number.isFinite(input.paid_minor ?? NaN) ? Math.round(input.paid_minor ?? 0) : 0;
  const paid = Math.min(total, Math.max(0, rawPaid));
  const balance = Math.max(0, total - paid);
  if (paid <= 0) return { payment_status: 'unpaid', paid_minor: 0, balance_due_minor: total };
  if (balance <= 0) return { payment_status: 'paid', paid_minor: total, balance_due_minor: 0 };
  return { payment_status: 'partially_paid', paid_minor: paid, balance_due_minor: balance };
}

export function paidMinorForInvoice(invoice: Invoice): number {
  if (typeof invoice.paid_minor === 'number') return Math.max(0, Math.round(invoice.paid_minor));
  // Defensive for imported/backfilled rows that predate v1.2.
  return Math.max(0, Math.round(invoice.total_minor));
}

export function balanceDueForInvoice(invoice: Invoice): number {
  if (typeof invoice.balance_due_minor === 'number') {
    return Math.max(0, Math.round(invoice.balance_due_minor));
  }
  return Math.max(0, Math.round(invoice.total_minor) - paidMinorForInvoice(invoice));
}

export function paymentStatusForInvoice(
  invoice: Invoice,
  now: Date = new Date(),
): InvoicePaymentStatus {
  const balance = balanceDueForInvoice(invoice);
  if (balance <= 0) return 'paid';
  if (invoice.due_at) {
    const due = new Date(invoice.due_at);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) return 'overdue';
  }
  if (paidMinorForInvoice(invoice) > 0) return 'partially_paid';
  return 'unpaid';
}

export function invoiceIsOpen(invoice: Invoice): boolean {
  return balanceDueForInvoice(invoice) > 0 && invoice.deleted_at === null;
}

export async function createInvoice(db: InventarDB, input: CreateInvoiceInput): Promise<Invoice> {
  const ts = nowISO();
  const year = ts.slice(0, 4);
  const vatEnabled = input.vat_enabled ?? true;
  const totals = computeInvoiceTotals(input.lines, input.vat_pct, vatEnabled);
  const payment = computeInvoicePayment({
    total_minor: totals.total_minor,
    mode: input.payment_mode ?? 'paid',
    paid_minor: input.paid_minor,
  });
  return db.transaction('rw', [db.invoices, db.meta], async () => {
    const seq = await allocateInvoiceNumber(db, year);
    const invoice: Invoice = {
      id: newUUID(),
      number: formatNumber(year, seq),
      issued_at: ts,
      customer_id: input.customer_id ?? null,
      customer_name: input.customer_name,
      customer_address: input.customer_address,
      customer_fiscal_id: input.customer_fiscal_id,
      lines: input.lines,
      currency: input.currency,
      subtotal_minor: totals.subtotal_minor,
      vat_pct: input.vat_pct,
      vat_minor: totals.vat_minor,
      vat_enabled: vatEnabled,
      total_minor: totals.total_minor,
      payment_status: payment.payment_status,
      paid_minor: payment.paid_minor,
      balance_due_minor: payment.balance_due_minor,
      due_at: payment.balance_due_minor > 0 ? (input.due_at ?? null) : null,
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
