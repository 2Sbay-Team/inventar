import { type Article } from '../types';
import { normaliseDigits } from './normalise-digits';
import { stripDiacritics } from './strip-diacritics';

// Recomputes `Article.search_blob` deterministically from indexable fields.
// DATA_MODEL §5 prose: digit normalisation runs before indexing AND on user
// input, so this pipeline matches `tokenise()` exactly. The same alphabet on
// both sides is what makes prefix search match across FR/AR/EN.
//
// Variants (sizes) are intentionally NOT in the blob — size matching is a
// join via `variants.size`. See DATA_MODEL §5.

export type IndexableArticle = Pick<
  Article,
  'name' | 'internal_code' | 'brand' | 'colors' | 'category' | 'notes'
>;

export function computeSearchBlob(a: IndexableArticle): string {
  const joined = [
    a.name,
    a.internal_code,
    a.brand ?? '',
    ...a.colors,
    a.category,
    a.notes ?? '',
  ].join(' ');
  return stripDiacritics(normaliseDigits(joined)).toLowerCase();
}
