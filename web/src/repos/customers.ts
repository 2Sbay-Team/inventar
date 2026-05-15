import { type InventarDB } from '../db/db';
import { type Customer, type CustomerType, type ISODate, type UUID } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

export interface UpsertCustomerInput {
  id?: UUID;
  type?: CustomerType;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  fiscal_id?: string | null;
  notes?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildSearchBlob(input: {
  name: string;
  phone: string | null;
  email: string | null;
  fiscal_id: string | null;
  city: string | null;
  country: string | null;
}): string {
  return [input.name, input.phone, input.email, input.fiscal_id, input.city, input.country]
    .filter((x): x is string => Boolean(x))
    .join(' ')
    .toLowerCase();
}

export async function listCustomers(db: InventarDB): Promise<Customer[]> {
  const rows = await db.customers.toArray();
  return rows.filter((c) => c.deleted_at === null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchCustomers(db: InventarDB, query: string): Promise<Customer[]> {
  const q = query.trim().toLowerCase();
  const rows = await listCustomers(db);
  if (q.length === 0) return rows;
  return rows.filter((c) => c.search_blob.includes(q));
}

export async function upsertCustomer(
  db: InventarDB,
  input: UpsertCustomerInput,
): Promise<Customer> {
  const now: ISODate = nowISO();
  const existing = input.id ? await db.customers.get(input.id) : undefined;
  const name = input.name.trim();
  if (name.length === 0) throw new Error('customer name required');
  const row: Customer = {
    id: existing?.id ?? input.id ?? newUUID(),
    type: input.type ?? existing?.type ?? 'individual',
    name,
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
    city: clean(input.city),
    country: clean(input.country),
    fiscal_id: clean(input.fiscal_id),
    notes: clean(input.notes),
    search_blob: '',
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
  };
  row.search_blob = buildSearchBlob(row);
  await db.customers.put(row);
  return row;
}

export async function archiveCustomer(db: InventarDB, id: UUID): Promise<void> {
  const row = await db.customers.get(id);
  if (!row) return;
  await db.customers.put({ ...row, updated_at: nowISO(), deleted_at: nowISO() });
}
