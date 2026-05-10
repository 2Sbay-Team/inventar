import { type InventarDB } from '../db/db';
import { type Lot, type Movement, type UUID } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

// v0.5 ADR-019: Lots track expiry-dated batches of a single Variant.
//
// Lifecycle:
//   - Created automatically by /receive when the merchant enters an
//     expiry on a purchase movement. One Lot per purchase movement; the
//     Lot's `source_movement_id` links back to the creating movement.
//   - Read by /sell to pick a FIFO target (earliest expires_at first).
//   - Read by the dashboard's "Expiring soon" widget and /expiry screen.
//
// Quantity is derived (ADR-002 movement-as-truth):
//
//   remaining = original_quantity
//             - SUM(sale movements where lot_id = this.id, alive only)
//
// We do NOT store remaining_quantity. Lots stay append-only.

export interface CreateLotInput {
  variant_id: UUID;
  expires_at: string;
  original_quantity: number;
  source_movement_id: UUID;
  // Optional explicit timestamp; defaults to now. Receiving sessions
  // pass the session timestamp so all lots from one session sort
  // together if displayed by received_at.
  received_at?: string;
}

export async function createLot(db: InventarDB, input: CreateLotInput): Promise<Lot> {
  if (!Number.isInteger(input.original_quantity) || input.original_quantity <= 0) {
    throw new Error(
      `Lot.original_quantity must be a positive integer, got ${input.original_quantity}`,
    );
  }
  if (Number.isNaN(Date.parse(input.expires_at))) {
    throw new Error(`Lot.expires_at must be an ISO date, got ${input.expires_at}`);
  }
  const lot: Lot = {
    id: newUUID(),
    variant_id: input.variant_id,
    expires_at: input.expires_at,
    received_at: input.received_at ?? nowISO(),
    original_quantity: input.original_quantity,
    source_movement_id: input.source_movement_id,
    deleted_at: null,
  };
  await db.lots.add(lot);
  return lot;
}

// All alive lots for a variant, sorted by expires_at ascending (FIFO
// order — the earliest-expiring lot first).
export async function lotsForVariant(db: InventarDB, variantId: UUID): Promise<Lot[]> {
  const rows = await db.lots
    .where('[variant_id+expires_at]')
    .between([variantId, ''], [variantId, '￿'])
    .toArray();
  return rows.filter((l) => l.deleted_at === null);
}

// Lot remaining quantity. Sale movements with lot_id pointing at this
// lot are summed (their delta is negative, so we negate to get a count).
//
// v0.5 fix (commit 4): we cannot use `where('lot_id').equals(lotId)`
// because the v7 schema deliberately does NOT index lot_id (the
// original commit-1 reasoning that lot queries are always single-lot
// scoped turned out to be wrong — pickFifoLot iterates lots calling
// remainingForLot, and the unindexed where() throws "KeyPath lot_id
// on object store movements is not indexed"). Scope by variant_id
// (which IS indexed) and filter by lot_id in memory; the inner set is
// small (one variant's movements).
export async function remainingForLot(db: InventarDB, lotId: UUID): Promise<number> {
  const lot = await db.lots.get(lotId);
  if (!lot || lot.deleted_at !== null) return 0;
  const sales = await db.movements
    .where('variant_id')
    .equals(lot.variant_id)
    .filter((m) => m.lot_id === lotId)
    .toArray();
  let sold = 0;
  for (const m of sales) {
    if (m.deleted_at !== null) continue;
    if (m.type !== 'sale') continue;
    sold += -m.delta; // delta is negative on sales; sold is the absolute count
  }
  return Math.max(0, lot.original_quantity - sold);
}

// Returns the lot that a /sell scan should attribute to: earliest
// expires_at where remaining > 0. Null if the variant has no usable
// lots — callers fall back to recording the sale with lot_id=null.
export async function pickFifoLot(db: InventarDB, variantId: UUID): Promise<Lot | null> {
  const lots = await lotsForVariant(db, variantId);
  for (const lot of lots) {
    const remaining = await remainingForLot(db, lot.id);
    if (remaining > 0) return lot;
  }
  return null;
}

// All alive lots whose expires_at falls within the given window AND that
// still have remaining quantity. Used by the dashboard's "Expiring soon"
// widget and the /expiry screen.
//
// `withinDays` window is inclusive (today through today+N days). Past
// expiries are also included — the widget treats them as "expired"
// rather than "expiring".
export async function lotsExpiringWithin(
  db: InventarDB,
  withinDays: number,
  now: Date = new Date(),
): Promise<Array<{ lot: Lot; remaining: number; daysUntilExpiry: number }>> {
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD comparison; expires_at is stored in the same shape
  const rows = await db.lots.where('expires_at').belowOrEqual(cutoff).toArray();
  const out: Array<{ lot: Lot; remaining: number; daysUntilExpiry: number }> = [];
  const today = now.toISOString().slice(0, 10);
  for (const lot of rows) {
    if (lot.deleted_at !== null) continue;
    const remaining = await remainingForLot(db, lot.id);
    if (remaining <= 0) continue;
    const ms = Date.parse(lot.expires_at) - Date.parse(today);
    const daysUntilExpiry = Math.ceil(ms / (24 * 60 * 60 * 1000));
    out.push({ lot, remaining, daysUntilExpiry });
  }
  // Earliest first.
  out.sort((a, b) => (a.lot.expires_at < b.lot.expires_at ? -1 : 1));
  return out;
}

// Look up the lot a sale movement was attributed to. Returns null if the
// movement has no lot_id (legacy or non-perishable). Used by activity
// feed and the (future) lot-breakdown view in Article detail.
export async function lotForMovement(db: InventarDB, movement: Movement): Promise<Lot | null> {
  if (!movement.lot_id) return null;
  const lot = await db.lots.get(movement.lot_id);
  if (!lot || lot.deleted_at !== null) return null;
  return lot;
}

// Soft-delete a lot. Used when /expiry's "Mark damaged" action writes off
// the remaining quantity and tombstones the lot to keep it out of FIFO
// rotation. The damage is recorded as a separate movement so the audit
// trail stays clean.
export async function softDeleteLot(db: InventarDB, lotId: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.lots.update(lotId, { deleted_at: ts });
  if (updated === 0) throw new Error(`No lot with id ${lotId}`);
}
