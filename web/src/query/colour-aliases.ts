// SPEC §1.4: a Tunisian merchant searches in a mix of FR/AR/EN. The chip
// list in Add Article stores a canonical English colour key, but the
// merchant types in their own locale ("blanc", "أبيض", "white"). Query-time
// expansion maps any of those tokens back to a common form so all three find
// the same article without having to denormalise the article's stored
// colours[].
//
// Strings are pre-normalised: lowercase, ASCII diacritic-stripped (already
// applied to FR aliases), Eastern→Western digits already mapped (no digits
// here, but kept for symmetry with the rest of the search pipeline).

export const CANONICAL_COLOURS = [
  'white',
  'black',
  'brown',
  'blue',
  'red',
  'beige',
  'multi',
] as const;
export type CanonicalColour = (typeof CANONICAL_COLOURS)[number];

// Each canonical key lists *every* alias that should match it. The canonical
// itself is included so a single lookup table works for both directions.
const ALIASES: Record<CanonicalColour, readonly string[]> = {
  white: ['white', 'blanc', 'blanche', 'أبيض', 'بيضاء'],
  black: ['black', 'noir', 'noire', 'أسود', 'سوداء'],
  brown: ['brown', 'marron', 'brun', 'بني', 'بنية'],
  blue: ['blue', 'bleu', 'bleue', 'أزرق', 'زرقاء'],
  red: ['red', 'rouge', 'أحمر', 'حمراء'],
  beige: ['beige', 'بيج'],
  multi: ['multi', 'multicolor', 'multicolore', 'متعدد'],
};

// Pre-built reverse index: any alias → the set of every alias for the same
// canonical, including itself. Lookup is constant-time at runtime.
const REVERSE: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const aliases of Object.values(ALIASES)) {
    for (const a of aliases) m.set(a.toLowerCase(), aliases);
  }
  return m;
})();

// Returns the alias group for a given token, or just [token] if unknown.
// Tokens already pass through tokenise() (lowercase, diacritic-stripped,
// digit-normalised), so alias keys here are the canonical-cased form too.
export function expandColourAlias(token: string): readonly string[] {
  return REVERSE.get(token) ?? [token];
}
