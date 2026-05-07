import { normaliseDigits } from './normalise-digits';
import { stripDiacritics } from './strip-diacritics';

// Splits a user-typed query into the canonical tokens used for prefix search
// against `articles.search_blob`. Pipeline mirrors `computeSearchBlob` so the
// producer (index) and consumer (query) end up in the same alphabet:
//   1. normaliseDigits  — Eastern Arabic → Western digits
//   2. stripDiacritics  — drop combining marks
//   3. toLowerCase      — case-fold for the prefix match
//   4. split on whitespace, drop empties

export function tokenise(input: string): string[] {
  if (!input) return [];
  return stripDiacritics(normaliseDigits(input))
    .toLowerCase()
    .split(/\s+/u)
    .filter((t) => t.length > 0);
}
