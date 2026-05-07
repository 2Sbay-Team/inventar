import { type InventarDB } from '../db/db';
import { type UUID, type Variant } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

// SPEC §6: size is required, alphanumeric, max 8 chars. We trim and assert
// here so a UI bug cannot persist whitespace-padded duplicates that would
// then look distinct in the size grid.

const MAX_SIZE_LEN = 8;
const SIZE_RE = /^[\p{L}\p{N}.x/-]+$/u;

function assertSize(size: string): void {
  if (size.length === 0) throw new Error('Variant.size cannot be empty');
  if (size.length > MAX_SIZE_LEN) {
    throw new Error(`Variant.size exceeds ${MAX_SIZE_LEN} chars: ${size}`);
  }
  if (!SIZE_RE.test(size)) {
    throw new Error(`Variant.size has invalid characters: ${size}`);
  }
}

export async function getVariantsForArticle(db: InventarDB, articleId: UUID): Promise<Variant[]> {
  return db.variants
    .where('article_id')
    .equals(articleId)
    .filter((v) => v.deleted_at === null)
    .sortBy('size');
}

// Adds the given sizes to an article, idempotently: if a (live or
// tombstoned) variant already exists for `[article_id, size]`, it is
// reused — tombstoned rows are revived so the historical movements stay
// joined to the same variant id.
export async function addVariants(
  db: InventarDB,
  articleId: UUID,
  sizes: string[],
): Promise<Variant[]> {
  const trimmed = sizes.map((s) => s.trim());
  trimmed.forEach(assertSize);
  const unique = Array.from(new Set(trimmed));
  const ts = nowISO();

  return db.transaction('rw', db.variants, async () => {
    const out: Variant[] = [];
    for (const size of unique) {
      const existing = await db.variants
        .where('[article_id+size]')
        .equals([articleId, size])
        .first();
      if (existing) {
        if (existing.deleted_at !== null) {
          const revived: Variant = { ...existing, deleted_at: null, updated_at: ts };
          await db.variants.put(revived);
          out.push(revived);
        } else {
          out.push(existing);
        }
        continue;
      }
      const v: Variant = {
        id: newUUID(),
        article_id: articleId,
        size,
        hidden: false,
        updated_at: ts,
        deleted_at: null,
      };
      await db.variants.add(v);
      out.push(v);
    }
    return out;
  });
}

// SPEC §2.3 long-press cell → "Hide this size" (cosmetic only). Quantities
// stay derivable; the variant just disappears from default size-grid render.
export async function setVariantHidden(db: InventarDB, id: UUID, hidden: boolean): Promise<void> {
  const ts = nowISO();
  const updated = await db.variants.update(id, { hidden, updated_at: ts });
  if (updated === 0) throw new Error(`No variant with id ${id}`);
}

// Soft delete a variant. Used by Article hard-delete in the cascade — and
// available to callers that need to retire a size without losing its
// movement history (the movements still exist with their variant_id, so
// historical reports remain consistent).
export async function softDeleteVariant(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  const updated = await db.variants.update(id, { deleted_at: ts, updated_at: ts });
  if (updated === 0) throw new Error(`No variant with id ${id}`);
}
