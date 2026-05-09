import { type Article } from '../types';
import { normaliseDigits } from './normalise-digits';
import { stripDiacritics } from './strip-diacritics';

// Recomputes `Article.search_blob` deterministically from indexable fields.
// DATA_MODEL §5 prose: digit normalisation runs before indexing AND on user
// input, so this pipeline matches `tokenise()` exactly. The same alphabet on
// both sides is what makes prefix search match across FR/AR/EN.
//
// v0.3 / ADR-011: colours moved off Article and onto Variant. Callers that
// already have the variants in hand pass them via the second argument so
// every distinct colour lands in the blob. Callers that don't (legacy
// reads, the denormalised cache flush during incremental updates) fall
// back to `article.colors`, which is kept in sync by createArticle /
// updateArticle / refreshArticleDenormalisedFields.
//
// Variants (sizes) are intentionally NOT in the blob — size matching is a
// join via `variants.size`. See DATA_MODEL §5.

export type IndexableArticle = Pick<
  Article,
  'name' | 'internal_code' | 'brand' | 'category' | 'notes' | 'colors'
>;

export interface IndexableVariantColor {
  color: string | null;
}

export function computeSearchBlob(
  a: IndexableArticle,
  variants?: ReadonlyArray<IndexableVariantColor>,
): string {
  const colors =
    variants !== undefined
      ? Array.from(
          new Set(variants.map((v) => (v.color === null ? '' : v.color)).filter((c) => c !== '')),
        )
      : a.colors;
  const joined = [
    a.name,
    a.internal_code,
    a.brand ?? '',
    ...colors,
    a.category,
    a.notes ?? '',
  ].join(' ');
  return stripDiacritics(normaliseDigits(joined)).toLowerCase();
}
