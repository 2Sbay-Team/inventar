import { type FashionSubtype, type FashionSubtypePredefined } from '../types';

// v0.5.2 ADR-021 / ADR-018: Fashion sub-types. Mirrors shop-subtypes.ts
// for the merged fashion vertical. The merchant picks any combination at
// onboarding (multi-select, ≥1 required); the union of their selected
// sub-types' default categories becomes the suggestion list in Add
// Article.
//
// `size_hint` drives the size-input UX in Add Article (commit 10):
//   - 'numeric_eu' — EU shoe sizes (36-46) — autocomplete with
//     numeric values. Used for adult shoes.
//   - 'numeric_kids' — kids' shoe sizes (20-32) — same shape, smaller
//     scale.
//   - 'letter' — letter sizes (XS, S, M, L, XL, XXL, XXXL). Used for
//     menswear.
//   - 'letter_or_numeric' — both options shown. Used for womenswear.
//   - 'age' — age-coded sizes (3M, 6M, 12M, ...). Used for kidswear.
//   - 'none' — sizeless (accessories, bags, jewelry). The matrix
//     collapses to a single row.

export type SizeHint =
  | 'numeric_eu'
  | 'numeric_kids'
  | 'letter'
  | 'letter_or_numeric'
  | 'age'
  | 'none';

export interface FashionSubtypeConfig {
  label_key: string;
  desc_key: string;
  categories: readonly string[];
  size_hint: SizeHint;
}

// Type-keyed config: uses FashionSubtypePredefined so we get
// exhaustiveness checking when adding a new predefined entry. There are
// no legacy fashion subtypes (the vertical is brand new in v0.5.2).
export const FASHION_SUBTYPE_CONFIG: Record<FashionSubtypePredefined, FashionSubtypeConfig> = {
  shoes: {
    label_key: 'shoes_label',
    desc_key: 'shoes_desc',
    categories: ['sport', 'dress', 'casual'],
    size_hint: 'numeric_eu',
  },
  shoes_kids: {
    label_key: 'shoes_kids_label',
    desc_key: 'shoes_kids_desc',
    categories: ['sport', 'school', 'casual'],
    size_hint: 'numeric_kids',
  },
  clothing_men: {
    label_key: 'clothing_men_label',
    desc_key: 'clothing_men_desc',
    categories: ['shirts', 'trousers', 'jackets', 'formal'],
    size_hint: 'letter',
  },
  clothing_women: {
    label_key: 'clothing_women_label',
    desc_key: 'clothing_women_desc',
    categories: ['tops', 'bottoms', 'dresses', 'outerwear'],
    size_hint: 'letter_or_numeric',
  },
  clothing_kids: {
    label_key: 'clothing_kids_label',
    desc_key: 'clothing_kids_desc',
    categories: ['tops', 'bottoms', 'outerwear', 'school'],
    size_hint: 'age',
  },
  accessories: {
    label_key: 'accessories_label',
    desc_key: 'accessories_desc',
    categories: ['scarves', 'hats', 'belts', 'gloves'],
    size_hint: 'none',
  },
  bags: {
    label_key: 'bags_label',
    desc_key: 'bags_desc',
    categories: ['handbags', 'backpacks', 'wallets'],
    size_hint: 'none',
  },
  jewelry: {
    label_key: 'jewelry_label',
    desc_key: 'jewelry_desc',
    categories: ['rings', 'necklaces', 'earrings', 'bracelets'],
    size_hint: 'none',
  },
};

// Display order for the onboarding + Settings picker.
export const FASHION_SUBTYPE_ORDER: readonly FashionSubtypePredefined[] = [
  'shoes',
  'shoes_kids',
  'clothing_men',
  'clothing_women',
  'clothing_kids',
  'accessories',
  'bags',
  'jewelry',
];

// Size-hint autocomplete values per category. Empty for 'none'. Used by
// the Add Article size input (commit 10) to pre-suggest plausible size
// labels — the merchant can still type any value.
export const SIZE_HINT_VALUES: Record<SizeHint, readonly string[]> = {
  numeric_eu: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  numeric_kids: ['20', '21', '22', '24', '26', '28', '30', '32'],
  letter: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'],
  letter_or_numeric: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '36', '38', '40', '42', '44', '46'],
  age: ['3M', '6M', '12M', '18M', '2Y', '3Y', '4Y', '5Y', '6Y', '8Y', '10Y', '12Y'],
  none: [],
};

export function getFashionSubtypeConfig(subtype: FashionSubtype): FashionSubtypeConfig | undefined {
  return (FASHION_SUBTYPE_CONFIG as Record<string, FashionSubtypeConfig>)[subtype];
}

export function categoriesForFashionSubtypes(subtypes: readonly FashionSubtype[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of subtypes) {
    const cfg = getFashionSubtypeConfig(st);
    if (!cfg) continue;
    for (const c of cfg.categories) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

// Returns the size-hint values across the union of selected sub-types.
// Deduplicated, preserves first-appearance order. Empty if every selected
// sub-type is 'none' (accessories / bags / jewelry).
export function sizeHintValuesForSubtypes(subtypes: readonly FashionSubtype[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of subtypes) {
    const cfg = getFashionSubtypeConfig(st);
    if (!cfg) continue;
    for (const v of SIZE_HINT_VALUES[cfg.size_hint]) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}
