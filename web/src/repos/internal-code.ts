import { type InventarDB } from '../db/db';

// DATA_MODEL §4: Articles get a human-readable "PFX-NNNN" code, zero-padded
// to four digits, allocated globally across the catalogue. The prefix
// comes from the active store_type's sku_prefix (SH for shoes, CL for
// clothes, KI for kiosk, GR for grocery). The code is derived from the
// maximum existing code's numeric tail — including archived AND soft-
// deleted rows — so a deleted "SH-0042" never returns to circulation.
//
// We rely on the lexicographic order of zero-padded numeric tails
// ("SH-0099" < "SH-0100"), which is why the padding is fixed-width. If
// the catalogue ever exceeds 9999 articles the padding widens
// automatically (the parsed integer keeps incrementing); ordering breaks
// at that boundary, but the MVP target is two orders of magnitude below.
//
// Mixed-prefix scenarios: a user who switches store_type after creating
// articles will end up with a mix of prefixes. The parser strips the
// prefix portion (everything before the last '-') and parses the numeric
// tail, so the next code keeps incrementing the global max regardless of
// which prefix it had.

const PAD = 4;

// Default for callers that haven't been threaded through the per-store
// type config yet (tests, legacy code paths). Real callers should pass
// the active store_type's sku_prefix.
const DEFAULT_PREFIX = 'SH';

function tailNumber(internalCode: string): number | null {
  const dash = internalCode.lastIndexOf('-');
  if (dash < 0) return null;
  const tail = internalCode.slice(dash + 1);
  const n = Number.parseInt(tail, 10);
  return Number.isFinite(n) ? n : null;
}

export async function nextInternalCode(
  db: InventarDB,
  prefix: string = DEFAULT_PREFIX,
): Promise<string> {
  // We can't rely on Dexie ordering across mixed prefixes, so scan all
  // codes and pick the max tail. Article count is small (MVP cap ~500)
  // so the linear pass is cheap.
  const all = await db.articles.toArray();
  let max = 0;
  for (const a of all) {
    const n = tailNumber(a.internal_code);
    if (n !== null && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(PAD, '0')}`;
}
