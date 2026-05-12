// Context-aware size suggestions for the Add Article step-2 chip rail.
//
// The chips are tappable hints rendered above each colour block's size
// rows. They only narrow what the merchant *sees first* — every size
// field still accepts free text, so a merchant who carries a size not
// in the list can always type it in.
//
// Input axes:
//   • fashion sub-types from ShopProfile (drives clothing letter vs
//     shoe numeric, kids' age sizes, etc.)
//   • unit of measure picked on step 1 (drives meter / pack / dozen
//     suggestions that have no fashion analogue)
//   • category picked on step 1 (narrows accessories → belts vs hats,
//     food vs beverages, etc.)
//   • size standard from ShopProfile (EU/US/UK/JP — flips shoe size
//     numbering and women's clothing numeric sizes)
//   • article name (free-text contextual signals like "bottle", "1L",
//     "powder" — used only when no stronger signal applies)
//
// Falls back to an empty array when no context matches; the UI shows
// the free-text input only in that case.

import { type FashionSubtype, type SizeStandard, type Uom } from '../types';

export interface SizeSuggestionInput {
  storeType: string;
  fashionSubtypes: readonly FashionSubtype[];
  unit: Uom;
  category: string;
  sizeStandard: SizeStandard;
  articleName: string;
}

const SHOE_SIZES_BY_STANDARD: Record<SizeStandard, readonly string[]> = {
  EU: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  US: ['6', '7', '8', '9', '10', '11', '12', '13'],
  UK: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  JP: ['22', '23', '24', '25', '26', '27', '28', '29', '30'],
};

// Kids' shoes — EU has a defined range; other standards approximate
// (kids' sizing maps near-1:1 across systems in practice).
const KIDS_SHOE_SIZES_BY_STANDARD: Record<SizeStandard, readonly string[]> = {
  EU: [
    '20',
    '21',
    '22',
    '23',
    '24',
    '25',
    '26',
    '27',
    '28',
    '29',
    '30',
    '31',
    '32',
    '33',
    '34',
    '35',
  ],
  US: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
  UK: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
  JP: ['12', '13', '14', '15', '16', '17', '18', '19', '20', '21'],
};

const MEN_LETTER_SIZES: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const MEN_PANT_SIZES: readonly string[] = ['28', '30', '32', '34', '36', '38', '40', '42', '44'];

const WOMEN_LETTER_SIZES: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const WOMEN_NUMERIC_SIZES_BY_STANDARD: Record<SizeStandard, readonly string[]> = {
  EU: ['34', '36', '38', '40', '42', '44', '46', '48'],
  US: ['0', '2', '4', '6', '8', '10', '12', '14'],
  UK: ['6', '8', '10', '12', '14', '16', '18', '20'],
  JP: ['5', '7', '9', '11', '13', '15'],
};

const KIDS_AGE_SIZES: readonly string[] = [
  '3M',
  '6M',
  '9M',
  '12M',
  '18M',
  '2Y',
  '3Y',
  '4Y',
  '6Y',
  '8Y',
  '10Y',
  '12Y',
  '14Y',
  '16Y',
];

const BELT_SIZES: readonly string[] = ['80', '85', '90', '95', '100', '105', '110', '115', '120'];

const RING_SIZES_BY_STANDARD: Record<SizeStandard, readonly string[]> = {
  EU: ['14', '15', '16', '17', '18', '19', '20', '21'],
  US: ['3', '4', '5', '6', '7', '8', '9', '10'],
  UK: ['F', 'H', 'J', 'L', 'N', 'P', 'R', 'T'],
  JP: ['5', '7', '9', '11', '13', '15', '17', '19'],
};

const BAG_SIZES: readonly string[] = ['Small', 'Medium', 'Large'];

const BEVERAGE_VOLUMES: readonly string[] = [
  '100ml',
  '250ml',
  '330ml',
  '500ml',
  '750ml',
  '1L',
  '1.5L',
  '2L',
];

const FOOD_WEIGHTS: readonly string[] = [
  '100g',
  '200g',
  '250g',
  '500g',
  '750g',
  '1kg',
  '2kg',
  '5kg',
];

const PACK_COUNTS: readonly string[] = [
  '2-pack',
  '4-pack',
  '6-pack',
  '10-pack',
  '12-pack',
  '24-pack',
];

const METER_LENGTHS: readonly string[] = ['0.5m', '1m', '2m', '3m', '5m', '10m'];

const DOZEN_COUNTS: readonly string[] = ['1 dozen', '2 dozen', '3 dozen'];

const SHIRT_CATEGORIES = new Set(['shirts', 'trousers', 'jackets', 'formal']);
const TOPS_CATEGORIES = new Set(['tops', 'bottoms', 'dresses', 'outerwear']);
const HAT_SCARF_CATEGORIES = new Set(['hats', 'scarves', 'gloves']);
const BELT_CATEGORIES = new Set(['belts']);
const RING_CATEGORIES = new Set(['rings', 'necklaces', 'earrings', 'bracelets']);

const BEVERAGE_NAME_HINTS = /\b(ml|cl|bottle|can|drink|juice|soda|water)\b/i;
const FOOD_WEIGHT_NAME_HINTS = /\b(g|gr|kg|powder|sugar|flour|rice|salt|coffee|tea)\b/i;

function hasAnySubtype(subs: readonly string[], targets: readonly string[]): boolean {
  return subs.some((s) => targets.includes(s));
}

// Returns the chip suggestions for the current Add Article context.
// Order matters: UoM-specific rules (pack / meter / dozen) come first,
// then fashion sub-type narrowing, then category-only fallbacks, then
// free-text-on-name signals, then empty.
export function getSizeSuggestions(input: SizeSuggestionInput): readonly string[] {
  const { storeType, fashionSubtypes, unit, category, sizeStandard, articleName } = input;
  const cat = category.trim().toLowerCase();
  const name = articleName.trim();

  if (unit === 'pack') return PACK_COUNTS;
  if (unit === 'meter') return METER_LENGTHS;
  if (unit === 'dozen') return DOZEN_COUNTS;

  const fashion = storeType === 'fashion';

  if (fashion && unit === 'pair') {
    const hasAdult = hasAnySubtype(fashionSubtypes, ['shoes']);
    const hasKids = hasAnySubtype(fashionSubtypes, ['shoes_kids']);
    // When the merchant stocks BOTH adult and kids' shoes, we can't
    // tell from the profile alone which range applies to the current
    // article — surface both ranges (kids first, adult after) and let
    // them tap. Picking kids-only or adult-only at the profile level
    // narrows to that range. Otherwise: empty fall-through.
    if (hasAdult && hasKids) {
      return [
        ...KIDS_SHOE_SIZES_BY_STANDARD[sizeStandard],
        ...SHOE_SIZES_BY_STANDARD[sizeStandard],
      ];
    }
    if (hasKids) return KIDS_SHOE_SIZES_BY_STANDARD[sizeStandard];
    if (hasAdult) return SHOE_SIZES_BY_STANDARD[sizeStandard];
  }

  if (unit === 'piece') {
    if (fashion) {
      if (hasAnySubtype(fashionSubtypes, ['clothing_kids'])) return KIDS_AGE_SIZES;

      if (hasAnySubtype(fashionSubtypes, ['clothing_men'])) {
        if (cat === 'trousers' || cat === 'bottoms') return MEN_PANT_SIZES;
        return MEN_LETTER_SIZES;
      }

      if (hasAnySubtype(fashionSubtypes, ['clothing_women'])) {
        return [...WOMEN_LETTER_SIZES, ...WOMEN_NUMERIC_SIZES_BY_STANDARD[sizeStandard]];
      }

      if (hasAnySubtype(fashionSubtypes, ['accessories'])) {
        if (BELT_CATEGORIES.has(cat)) return BELT_SIZES;
        if (HAT_SCARF_CATEGORIES.has(cat)) return ['One size'];
      }

      if (hasAnySubtype(fashionSubtypes, ['jewelry'])) {
        if (RING_CATEGORIES.has(cat) || cat === 'rings') {
          return RING_SIZES_BY_STANDARD[sizeStandard];
        }
      }

      if (hasAnySubtype(fashionSubtypes, ['bags'])) return BAG_SIZES;
    }

    // Sub-type independent rules — fire when no fashion narrowing above
    // applied. Category-first, then article-name signals.
    if (cat === 'beverages' || cat === 'beverage' || cat === 'drinks') return BEVERAGE_VOLUMES;
    if (cat === 'food' || cat === 'food_beverages') return FOOD_WEIGHTS;
    if (cat === 'powder') return FOOD_WEIGHTS;

    if (BEVERAGE_NAME_HINTS.test(name)) return BEVERAGE_VOLUMES;
    if (FOOD_WEIGHT_NAME_HINTS.test(name)) return FOOD_WEIGHTS;

    // Untouched categories from the legacy code path still get rough
    // letter / pant fallbacks via SHIRT_CATEGORIES / TOPS_CATEGORIES.
    if (SHIRT_CATEGORIES.has(cat)) return MEN_LETTER_SIZES;
    if (TOPS_CATEGORIES.has(cat)) return WOMEN_LETTER_SIZES;
  }

  return [];
}
