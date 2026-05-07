// DATA_MODEL §5: NFD-decompose, drop combining marks (U+0300..U+036F), then
// recompose to NFC. The spec's strip range covers Latin combining marks only
// ("café" → "cafe"); Arabic harakat (U+064B..U+065F) are intentionally NOT
// stripped — Tunisian Arabic input is unvocalised in practice, and the spec's
// trilingual examples (SPEC §1.4) all use unvocalised text.
//
// NFC at the end is an extension over the DATA_MODEL pseudocode: it makes
// the function idempotent and keeps precomposed inputs that contain no
// stripped marks equal to themselves (otherwise NFD-decomposed Arabic
// alef-with-hamza would not round-trip). Matching semantics are unchanged
// because computeSearchBlob and tokenise both go through the same pipeline.

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}
