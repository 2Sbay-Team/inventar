import { type CurrencyCode, type InvoicePaymentStatus, type ISODate, type UUID } from '../types';

// Customer / invoice-payment domain scaffolding.
//
// This file intentionally does NOT change the current Dexie schema yet.
// It captures the next business model discussed for Inventar:
// - the merchant has Product master data and should also have Customer master data
// - an invoice can be unpaid, partially paid, paid, overdue, cancelled, or refunded
// - dashboard cash should be based on actual payments, not merely issued invoices
//
// When this feature is implemented, add Dexie tables for customers and payments,
// then wire these types into Sale/Invoice screens.

export type CustomerType = 'individual' | 'company';

export interface CustomerMasterRecord {
  id: UUID;
  type: CustomerType;
  display_name: string;
  legal_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  fiscal_id: string | null;
  notes: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface CustomerInvoiceSnapshot {
  customer_id: UUID | null;
  display_name: string | null;
  legal_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  fiscal_id: string | null;
}

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'other';

export interface InvoicePaymentRecord {
  id: UUID;
  invoice_id: UUID;
  customer_id: UUID | null;
  amount_minor: number;
  currency: CurrencyCode;
  method: PaymentMethod;
  paid_at: ISODate;
  note: string | null;
  created_at: ISODate;
  deleted_at: ISODate | null;
}

export interface PaymentSummary {
  total_minor: number;
  paid_minor: number;
  balance_due_minor: number;
  status: InvoicePaymentStatus;
}

export function computePaymentSummary(input: {
  total_minor: number;
  paid_minor: number;
  due_at?: ISODate | null;
  cancelled?: boolean;
  refunded?: boolean;
  now?: Date;
}): PaymentSummary {
  const total = Math.max(0, Math.round(input.total_minor));
  const paid = Math.max(0, Math.round(input.paid_minor));
  const cappedPaid = Math.min(total, paid);
  const balance = Math.max(0, total - cappedPaid);

  if (input.cancelled) {
    return {
      total_minor: total,
      paid_minor: cappedPaid,
      balance_due_minor: balance,
      status: 'cancelled',
    };
  }
  if (input.refunded) {
    return {
      total_minor: total,
      paid_minor: cappedPaid,
      balance_due_minor: balance,
      status: 'refunded',
    };
  }
  if (total === 0 || balance === 0) {
    return { total_minor: total, paid_minor: cappedPaid, balance_due_minor: 0, status: 'paid' };
  }
  if (cappedPaid > 0) {
    return {
      total_minor: total,
      paid_minor: cappedPaid,
      balance_due_minor: balance,
      status: 'partially_paid',
    };
  }
  if (input.due_at) {
    const due = new Date(input.due_at);
    const now = input.now ?? new Date();
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      return { total_minor: total, paid_minor: 0, balance_due_minor: total, status: 'overdue' };
    }
  }
  return { total_minor: total, paid_minor: 0, balance_due_minor: total, status: 'unpaid' };
}
