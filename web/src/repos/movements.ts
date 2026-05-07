import { type InventarDB } from '../db/db';
import { type Movement, type MovementType, type UUID } from '../types';
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

export interface RecordMovementInput {
  variant_id: UUID;
  delta: number;
  type: MovementType;
  note?: string | null;
}

export async function recordMovement(
  db: InventarDB,
  input: RecordMovementInput,
): Promise<Movement> {
  if (!Number.isInteger(input.delta)) {
    throw new Error(`Movement.delta must be an integer, got ${input.delta}`);
  }
  if (input.delta === 0) {
    throw new Error('Movement.delta must be non-zero');
  }
  const m: Movement = {
    id: newUUID(),
    variant_id: input.variant_id,
    delta: input.delta,
    type: input.type,
    note: input.note ?? null,
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
