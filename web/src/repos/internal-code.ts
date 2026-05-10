import { type InventarDB } from '../db/db';

// DATA_MODEL §4: Articles get a human-readable "PFX-NNNN" code, zero-padded
// to four digits. The prefix comes from the active store_type's
// sku_prefix.
//
// v0.5.2 ADR-024: each prefix has an INDEPENDENT counter. The legacy
// global counter (used pre-v0.5.2) had the side effect that switching
// store_type left the new prefix continuing the old prefix's max — so
// a kiosk that had reached GR-0156 would allocate FN-0157 as the next
// fashion code. That's confusing for the merchant ("why does my first
// fashion item have number 157?") and breaks the "internal_code labels
// printed for SH-* still map to a meaningful sequence" assumption.
//
// New behaviour: per-prefix max+1. SH-0042 + FN-0008 → next fashion
// code is FN-0009. Empty per-prefix history → starts at PFX-0001.
//
// Legacy SH/CL/KI/GR codes from before the v0.5.2 vertical merge stay
// in place untouched; they just don't grow because new fashion / shop
// articles use the FN / SP prefixes going forward.

const PAD = 4;

// Default for callers that haven't been threaded through the per-store-
// type config (tests, legacy code paths). Real callers should pass the
// active store_type's sku_prefix.
const DEFAULT_PREFIX = 'SH';

function tailNumber(internalCode: string, prefix: string): number | null {
  // Match `${prefix}-(\d+)` exactly. Anchored on the prefix so SH-0042
  // doesn't pollute the FN-counter even though both end in -NNNN.
  if (!internalCode.startsWith(`${prefix}-`)) return null;
  const tail = internalCode.slice(prefix.length + 1);
  if (!/^\d+$/.test(tail)) return null;
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
}

export async function nextInternalCode(
  db: InventarDB,
  prefix: string = DEFAULT_PREFIX,
): Promise<string> {
  // Linear scan. Article count is small (MVP cap ~500), so even a O(n)
  // pass per allocation is cheap. We deliberately include archived AND
  // soft-deleted rows so a deleted "FN-0042" never returns to circulation.
  const all = await db.articles.toArray();
  let max = 0;
  for (const a of all) {
    const n = tailNumber(a.internal_code, prefix);
    if (n !== null && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(PAD, '0')}`;
}
