import { type InventarDB } from '../db/db';
import { type Expense, type ExpenseCategory, type RecurringPeriod, type UUID } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

// SPEC §2.7: a single Expense row covers Category + Amount + Note + Date +
// Recurring. Recurring backfill runs at app launch and is implemented as a
// separate scheduler — not in this repo — because it needs to know about
// "elapsed periods since last seen" which is screen/state concern, not a
// pure CRUD concern.

export interface AddExpenseInput {
  category: ExpenseCategory;
  amount_tnd: number;
  note: string | null;
  at: string; // ISO date, user-editable (SPEC §2.7)
  recurring: RecurringPeriod;
}

export async function addExpense(db: InventarDB, input: AddExpenseInput): Promise<Expense> {
  if (!Number.isFinite(input.amount_tnd) || input.amount_tnd <= 0) {
    throw new Error(`Expense.amount_tnd must be > 0, got ${input.amount_tnd}`);
  }
  if (!Number.isInteger(input.amount_tnd)) {
    throw new Error('Expense.amount_tnd must be an integer (millimes — ADR-005)');
  }
  const ts = nowISO();
  const e: Expense = {
    id: newUUID(),
    category: input.category,
    amount_tnd: input.amount_tnd,
    note: input.note,
    at: input.at,
    recurring: input.recurring,
    updated_at: ts,
    deleted_at: null,
  };
  await db.expenses.add(e);
  return e;
}

export type UpdateExpenseInput = Partial<
  Pick<Expense, 'category' | 'amount_tnd' | 'note' | 'at' | 'recurring'>
>;

export async function updateExpense(
  db: InventarDB,
  id: UUID,
  patch: UpdateExpenseInput,
): Promise<Expense> {
  if (patch.amount_tnd !== undefined) {
    if (!Number.isInteger(patch.amount_tnd) || patch.amount_tnd <= 0) {
      throw new Error(`Expense.amount_tnd must be a positive integer, got ${patch.amount_tnd}`);
    }
  }
  const ts = nowISO();
  return db.transaction('rw', db.expenses, async () => {
    const existing = await db.expenses.get(id);
    if (!existing) throw new Error(`No expense with id ${id}`);
    if (existing.deleted_at !== null) throw new Error(`Expense ${id} is deleted`);
    const merged: Expense = { ...existing, ...patch, updated_at: ts };
    await db.expenses.put(merged);
    return merged;
  });
}

export async function softDeleteExpense(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.expenses.update(id, { deleted_at: ts, updated_at: ts });
  if (updated === 0) throw new Error(`No expense with id ${id}`);
}

export interface ListExpensesOptions {
  // Inclusive lower bound on `at`.
  from?: string;
  // Exclusive upper bound on `at`. Half-open `[from, to)` so callers can
  // chain windows without double-counting boundary rows.
  to?: string;
  category?: ExpenseCategory;
}

// Backed by the `at` index. Newest first. Soft-deleted rows are filtered
// out — the Dashboard never wants them in totals.
export async function listExpenses(
  db: InventarDB,
  opts: ListExpensesOptions = {},
): Promise<Expense[]> {
  let collection = db.expenses.orderBy('at').reverse();

  if (opts.from !== undefined || opts.to !== undefined) {
    const lo = opts.from ?? '';
    const hi = opts.to ?? '￿';
    collection = db.expenses.where('at').between(lo, hi, true, false).reverse();
  }

  const rows = await collection.toArray();
  return rows.filter((e) => {
    if (e.deleted_at !== null) return false;
    if (opts.category && e.category !== opts.category) return false;
    return true;
  });
}
