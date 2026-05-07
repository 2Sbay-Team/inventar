import { type InventarDB } from '../db/db';
import { type UUID, type Variant } from '../types';

// ADR-002 (movement-as-truth): Variants do not store a quantity column.
// Stock is derived from the sum of non-tombstoned movement deltas. Reverted
// movements (deleted_at != null) are excluded.

export async function quantityFor(db: InventarDB, variantId: UUID): Promise<number> {
  let sum = 0;
  await db.movements
    .where('variant_id')
    .equals(variantId)
    .each((m) => {
      if (m.deleted_at === null) sum += m.delta;
    });
  return sum;
}

export interface SizeGridCell {
  variant_id: UUID;
  size: string;
  qty: number;
  hidden: boolean;
}

// Returns one cell per alive variant of the article, in lexicographic size
// order. Hidden variants are returned with `hidden: true` so the UI can
// decide whether to render them (long-press on a cell hides it cosmetically;
// SPEC §2.3).
export async function sizeGridFor(db: InventarDB, articleId: UUID): Promise<SizeGridCell[]> {
  const variants: Variant[] = await db.variants
    .where('article_id')
    .equals(articleId)
    .filter((v) => v.deleted_at === null)
    .sortBy('size');

  return Promise.all(
    variants.map(async (v) => ({
      variant_id: v.id,
      size: v.size,
      qty: await quantityFor(db, v.id),
      hidden: v.hidden,
    })),
  );
}
