import { type InventarDB } from '../db/db';

// DATA_MODEL §4: Articles get a human-readable "SH-NNNN" code, zero-padded
// to four digits, allocated globally across the catalogue. The code is
// derived from the maximum existing code — including archived AND
// soft-deleted rows — so a deleted "SH-0042" never returns to circulation.
//
// We rely on the lexicographic order of zero-padded codes ("SH-0099" <
// "SH-0100"), which is why the padding is fixed-width. If the catalogue
// ever exceeds 9999 articles the padding widens automatically (the parsed
// integer keeps incrementing); ordering breaks at that boundary, but the
// MVP target is two orders of magnitude below it.

const PREFIX = 'SH-';
const PAD = 4;

export async function nextInternalCode(db: InventarDB): Promise<string> {
  const last = await db.articles.orderBy('internal_code').reverse().first();
  if (!last) return `${PREFIX}${'1'.padStart(PAD, '0')}`;
  const tail = last.internal_code.slice(PREFIX.length);
  const n = Number.parseInt(tail, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot parse internal_code: ${last.internal_code}`);
  }
  return `${PREFIX}${String(n + 1).padStart(PAD, '0')}`;
}
