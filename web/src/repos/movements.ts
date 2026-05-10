import { type InventarDB } from '../db/db';
import { type Location, type Movement, type MovementType, type UUID } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

// ADR-002: Movements are append-only, immutable, and the single source of
// truth for stock. Reverts use a tombstone (`deleted_at`); we never edit
// `delta`, `type`, or `created_at` in place — the audit trail must be
// trustworthy.
//
// SPEC §6 enforces `delta` is a non-zero integer. We assert it here so the
// invariant cannot leak past the repo boundary even if a UI bug allows a
// zero stepper through.
//
// ADR-012 (v0.3): every movement carries a location dimension. Sale /
// purchase / return / adjustment / damage record where the stock change
// happened (`location: 'floor' | 'back'`); transfer movements record an
// internal move between locations via `transfer_from` / `transfer_to`.
// Validation is strict — invalid combinations throw — so a UI bug cannot
// produce a row whose meaning depends on which field a downstream reader
// happens to look at first.

const LOCATIONED_TYPES: ReadonlyArray<MovementType> = [
  'sale',
  'purchase',
  'return',
  'adjustment',
  'damage',
];

export interface RecordMovementInput {
  variant_id: UUID;
  delta: number;
  type: MovementType;
  note?: string | null;
  // Optional per-unit price override in minor units. Only meaningful for
  // sale movements where the customer paid a discounted / promotional
  // price. Null = use the article's catalogue sale_price_tnd at read
  // time. Validated as a non-negative integer when provided.
  unit_price_tnd?: number | null;
  // Required for sale / purchase / return / adjustment / damage. Must
  // be omitted (or null) for transfer.
  location?: Location | null;
  // Required for transfer (must differ from each other). Must be omitted
  // (or null) for every other type.
  transfer_from?: Location | null;
  transfer_to?: Location | null;
  // v0.5 ADR-018: groups movements created in one /receive or /sell
  // session so the activity feed and dashboard can display them as a
  // single transaction. Optional — single-row paths (Quick Adjust,
  // Add Article seed) leave it null.
  transaction_id?: UUID | null;
  // v0.5 ADR-019: only meaningful on type='purchase' for items entering
  // a /receive flow with an expiry date. Validated as ISO date when set.
  expires_at?: string | null;
  // v0.5 ADR-019: only meaningful on type='sale' when /sell resolves to
  // a variant with at least one Lot. Set automatically by
  // recordSaleTransaction; can also be set manually via the long-form
  // Quick Adjust for non-FIFO sales.
  lot_id?: UUID | null;
}

function assertLocation(value: unknown): asserts value is Location {
  if (value !== 'floor' && value !== 'back') {
    throw new Error(`Movement.location must be 'floor' or 'back', got ${String(value)}`);
  }
}

function validate(input: RecordMovementInput): void {
  if (!Number.isInteger(input.delta)) {
    throw new Error(`Movement.delta must be an integer, got ${input.delta}`);
  }
  if (input.delta === 0) {
    throw new Error('Movement.delta must be non-zero');
  }
  if (input.unit_price_tnd != null) {
    if (!Number.isInteger(input.unit_price_tnd) || input.unit_price_tnd < 0) {
      throw new Error(
        `Movement.unit_price_tnd must be a non-negative integer, got ${input.unit_price_tnd}`,
      );
    }
  }
  if (input.expires_at != null) {
    if (typeof input.expires_at !== 'string' || Number.isNaN(Date.parse(input.expires_at))) {
      throw new Error(`Movement.expires_at must be an ISO date string, got ${input.expires_at}`);
    }
    if (input.type !== 'purchase') {
      throw new Error(
        `Movement.expires_at is only valid on type='purchase', got type='${input.type}'`,
      );
    }
  }
  if (input.lot_id != null && input.type !== 'sale') {
    throw new Error(`Movement.lot_id is only valid on type='sale', got type='${input.type}'`);
  }

  if (input.type === 'transfer') {
    if (input.location != null) {
      throw new Error("Movement.location must be null for type='transfer'");
    }
    if (input.transfer_from == null || input.transfer_to == null) {
      throw new Error("Movement.transfer_from and transfer_to are required for type='transfer'");
    }
    assertLocation(input.transfer_from);
    assertLocation(input.transfer_to);
    if (input.transfer_from === input.transfer_to) {
      throw new Error('Movement.transfer_from must differ from transfer_to');
    }
    if (input.delta < 0) {
      throw new Error(
        "Movement.delta for type='transfer' must be a positive integer (the absolute count moved)",
      );
    }
    return;
  }

  // Locationed types: sale / purchase / return / adjustment / damage.
  if (!LOCATIONED_TYPES.includes(input.type)) {
    throw new Error(`Unknown Movement.type: ${input.type}`);
  }
  if (input.location == null) {
    throw new Error(`Movement.location is required for type='${input.type}'`);
  }
  assertLocation(input.location);
  if (input.transfer_from != null || input.transfer_to != null) {
    throw new Error(`Movement.transfer_from / transfer_to must be null for type='${input.type}'`);
  }
}

export async function recordMovement(
  db: InventarDB,
  input: RecordMovementInput,
): Promise<Movement> {
  validate(input);
  const m: Movement = {
    id: newUUID(),
    variant_id: input.variant_id,
    delta: input.delta,
    type: input.type,
    note: input.note ?? null,
    unit_price_tnd: input.unit_price_tnd ?? null,
    location: input.type === 'transfer' ? null : (input.location as Location),
    transfer_from: input.type === 'transfer' ? (input.transfer_from as Location) : null,
    transfer_to: input.type === 'transfer' ? (input.transfer_to as Location) : null,
    transaction_id: input.transaction_id ?? null,
    expires_at: input.expires_at ?? null,
    lot_id: input.lot_id ?? null,
    created_at: nowISO(),
    deleted_at: null,
  };
  await db.movements.add(m);
  return m;
}

// SPEC §2.4: undo a Quick Adjust. We never re-edit the original row.
export async function revertMovement(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.movements.update(id, { deleted_at: ts });
  if (updated === 0) throw new Error(`No movement with id ${id}`);
}

// Reattach a flagged-for-review movement to a different variant id. Used
// by /migrations/review when the user picks the correct colour. Clears
// the `(migrated v5→v6 …)` marker from the note so the banner predicate
// stops matching the row.
export async function reassignMovementVariant(
  db: InventarDB,
  movementId: UUID,
  newVariantId: UUID,
  cleanedNote: string | null,
): Promise<void> {
  const updated = await db.movements.update(movementId, {
    variant_id: newVariantId,
    note: cleanedNote,
  });
  if (updated === 0) throw new Error(`No movement with id ${movementId}`);
}

export interface ListMovementsForVariantOptions {
  // Inclusive lower bound on `created_at`. Used for "movements since X".
  since?: string;
  // Hard cap on rows returned. The activity feed only ever shows a window.
  limit?: number;
}

// Newest-first. The [variant_id+created_at] compound index gives us the
// efficient range scan; we filter tombstones and sort in memory because
// Dexie cannot combine a compound-range cursor with a deleted_at predicate
// at the index level.
export async function listMovementsForVariant(
  db: InventarDB,
  variantId: UUID,
  opts: ListMovementsForVariantOptions = {},
): Promise<Movement[]> {
  const lo: [string, string] = [variantId, opts.since ?? ''];
  const hi: [string, string] = [variantId, '￿'];
  const rows = await db.movements.where('[variant_id+created_at]').between(lo, hi).toArray();
  const alive = rows
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return opts.limit !== undefined ? alive.slice(0, opts.limit) : alive;
}

// SPEC §2.3: Article detail shows the last 8 movements across all variants
// of the article. We resolve the variant ids first, then aggregate.
export async function listRecentMovementsForArticle(
  db: InventarDB,
  articleId: UUID,
  limit = 8,
): Promise<Movement[]> {
  const variantIds = (await db.variants
    .where('article_id')
    .equals(articleId)
    .primaryKeys()) as UUID[];
  if (variantIds.length === 0) return [];

  const rows = await db.movements.where('variant_id').anyOf(variantIds).toArray();
  return rows
    .filter((m) => m.deleted_at === null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, limit);
}
