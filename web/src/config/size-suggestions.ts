// Context-aware size suggestions for the Add Article step-2 chip rail.
//
// The chips are tappable hints rendered above each colour block's size
// rows. They only narrow what the merchant *sees first* — every size
// field still accepts free text, so a merchant who carries a size not
// in the list can always type it in.
//
// This file intentionally keeps the intelligence deterministic. It does
// not guess with an LLM. It reads the merchant's configured vertical
// (fashion/shop), chosen fashion sub-types, article unit, category,
// size-standard and article name, then chooses the safest suggestion
// pool. The rule is simple: category/name signals beat profile-wide
// defaults. This prevents a merchant who sells clothes + bags + shoes
// from seeing shirt sizes while adding a handbag.

import { type FashionSubtype, type SizeStandard, type Uom } from '../types';

export interface SizeSuggestionInput {
  storeType: string;
  fashionSubtypes: readonly FashionSubtype[];
  unit: Uom;
  category: string;
  sizeStandard: SizeStandard;
  articleName: string;
}

export type FashionSizeContext =
  | 'adult_shoes'
  | 'kids_shoes'
  | 'mixed_shoes'
  | 'men_clothing'
  | 'women_clothing'
  | 'kids_clothing'
  | 'bags'
  | 'belts'
  | 'hats_one_size'
  | 'rings'
  | 'none';

const SHOE_SIZES_BY_STANDARD: Record<SizeStandard, readonly string[]> = {
  EU: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'],
  US: ['6', '7', '8', '9', '10', '11', '12', '13'],
  UK: ['3', '4', '5', '6', '7', '8', '9', '10', '11', '12'],
  JP: ['22', '23', '24', '25', '26', '27', '28', '29', '30'],
};

// Kids' shoes — EU has a defined range; other standards approximate
// practical retail chip pools. The user can always type any size.
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

const MAX_SIZE_SUGGESTIONS = 18;
const GENERIC_CLOTHING_FALLBACK: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const MEN_CLOTHING_CATEGORIES = new Set([
  'men',
  'shirts',
  'shirt',
  'trousers',
  'pants',
  'jackets',
  'formal',
]);
const WOMEN_CLOTHING_CATEGORIES = new Set([
  'women',
  'tops',
  'top',
  'bottoms',
  'dresses',
  'dress',
  'outerwear',
]);
const KIDS_CATEGORIES = new Set(['kids', 'kid', 'children', 'child', 'baby', 'school']);
const TROUSER_CATEGORIES = new Set(['trousers', 'pants', 'bottoms']);
const HAT_SCARF_CATEGORIES = new Set(['hats', 'hat', 'scarves', 'scarf', 'gloves', 'glove']);
const BELT_CATEGORIES = new Set(['belts', 'belt']);
const RING_CATEGORIES = new Set([
  'rings',
  'ring',
  'necklaces',
  'necklace',
  'earrings',
  'earring',
  'bracelets',
  'bracelet',
]);
const BAG_CATEGORIES = new Set([
  'bags',
  'bag',
  'handbags',
  'handbag',
  'backpacks',
  'backpack',
  'wallets',
  'wallet',
]);

const BEVERAGE_NAME_HINTS = /\b(ml|cl|bottle|can|drink|juice|soda|water)\b/i;
const FOOD_WEIGHT_NAME_HINTS = /\b(g|gr|kg|powder|sugar|flour|rice|salt|coffee|tea)\b/i;

const KIDS_NAME_HINTS = /\b(kid|kids|child|children|baby|junior|toddler|school|boy|girl|infant)\b/i;
const WOMEN_NAME_HINTS = /\b(women|woman|lady|ladies|female|dress|skirt|blouse)\b/i;
const MEN_NAME_HINTS = /\b(men|man|male|gent|shirt|trouser|pants|jacket|formal)\b/i;
const BAG_NAME_HINTS = /\b(bag|handbag|backpack|wallet|purse|tote)\b/i;
const NON_FASHION_BAG_NAME_HINTS = /\b(garbage|trash|bin|rubbish|waste)\s+bags?\b/i;
const BELT_NAME_HINTS = /\b(belt)\b/i;
const HAT_NAME_HINTS = /\b(hat|cap|scarf|glove|beanie)\b/i;
const RING_NAME_HINTS = /\b(ring|necklace|earring|bracelet)\b/i;

function normaliseToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function hasAnySubtype(subs: readonly string[], targets: readonly string[]): boolean {
  return subs.some((s) => targets.includes(s));
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

function selectedPieceContexts(subtypes: readonly FashionSubtype[]): FashionSizeContext[] {
  const out: FashionSizeContext[] = [];
  if (hasAnySubtype(subtypes, ['clothing_kids'])) out.push('kids_clothing');
  if (hasAnySubtype(subtypes, ['clothing_men'])) out.push('men_clothing');
  if (hasAnySubtype(subtypes, ['clothing_women'])) out.push('women_clothing');
  if (hasAnySubtype(subtypes, ['bags'])) out.push('bags');
  return out;
}

function suggestionsForContext(
  context: FashionSizeContext,
  standard: SizeStandard,
): readonly string[] {
  switch (context) {
    case 'adult_shoes':
      return SHOE_SIZES_BY_STANDARD[standard];
    case 'kids_shoes':
      return KIDS_SHOE_SIZES_BY_STANDARD[standard];
    case 'mixed_shoes':
      return dedupe([
        ...KIDS_SHOE_SIZES_BY_STANDARD[standard],
        ...SHOE_SIZES_BY_STANDARD[standard],
      ]);
    case 'men_clothing':
      return MEN_LETTER_SIZES;
    case 'women_clothing':
      return [...WOMEN_LETTER_SIZES, ...WOMEN_NUMERIC_SIZES_BY_STANDARD[standard]];
    case 'kids_clothing':
      return KIDS_AGE_SIZES;
    case 'bags':
      return BAG_SIZES;
    case 'belts':
      return BELT_SIZES;
    case 'hats_one_size':
      return ['One size'];
    case 'rings':
      return RING_SIZES_BY_STANDARD[standard];
    case 'none':
      return [];
  }
}

// Public mainly for tests/QC. Add Article still only needs getSizeSuggestions.
export function inferFashionSizeContext(input: SizeSuggestionInput): FashionSizeContext {
  const { fashionSubtypes, unit, category, articleName } = input;
  const cat = normaliseToken(category);
  const name = articleName.trim();
  const hasAdultShoes = hasAnySubtype(fashionSubtypes, ['shoes']);
  const hasKidsShoes = hasAnySubtype(fashionSubtypes, ['shoes_kids']);
  const hasMen = hasAnySubtype(fashionSubtypes, ['clothing_men']);
  const hasWomen = hasAnySubtype(fashionSubtypes, ['clothing_women']);
  const hasKids = hasAnySubtype(fashionSubtypes, ['clothing_kids']);
  const hasAccessories = hasAnySubtype(fashionSubtypes, ['accessories']);
  const hasBags = hasAnySubtype(fashionSubtypes, ['bags']);
  const hasJewelry = hasAnySubtype(fashionSubtypes, ['jewelry']);

  if (unit === 'pair') {
    if (!hasAdultShoes && !hasKidsShoes) return 'none';
    const looksKids = KIDS_CATEGORIES.has(cat) || KIDS_NAME_HINTS.test(name);
    if (looksKids && hasKidsShoes) return 'kids_shoes';
    if (
      (MEN_CLOTHING_CATEGORIES.has(cat) ||
        WOMEN_CLOTHING_CATEGORIES.has(cat) ||
        MEN_NAME_HINTS.test(name) ||
        WOMEN_NAME_HINTS.test(name)) &&
      hasAdultShoes
    ) {
      return 'adult_shoes';
    }
    if (hasAdultShoes && hasKidsShoes) return 'mixed_shoes';
    if (hasKidsShoes) return 'kids_shoes';
    return 'adult_shoes';
  }

  if (unit !== 'piece') return 'none';

  // Category/name signals beat profile-wide order. This is the important
  // multi-subtype case: a fashion shop may sell shoes, clothes and bags,
  // but adding a handbag should not show shirt sizes.
  if ((BAG_CATEGORIES.has(cat) || BAG_NAME_HINTS.test(name)) && hasBags) return 'bags';
  if ((RING_CATEGORIES.has(cat) || RING_NAME_HINTS.test(name)) && hasJewelry) return 'rings';
  if ((BELT_CATEGORIES.has(cat) || BELT_NAME_HINTS.test(name)) && hasAccessories) return 'belts';
  if ((HAT_SCARF_CATEGORIES.has(cat) || HAT_NAME_HINTS.test(name)) && hasAccessories) {
    return 'hats_one_size';
  }
  if ((KIDS_CATEGORIES.has(cat) || KIDS_NAME_HINTS.test(name)) && hasKids) return 'kids_clothing';
  if ((MEN_CLOTHING_CATEGORIES.has(cat) || MEN_NAME_HINTS.test(name)) && hasMen)
    return 'men_clothing';
  if ((WOMEN_CLOTHING_CATEGORIES.has(cat) || WOMEN_NAME_HINTS.test(name)) && hasWomen) {
    return 'women_clothing';
  }

  const pieceContexts = selectedPieceContexts(fashionSubtypes);
  if (pieceContexts.length === 1) return pieceContexts[0];

  // When the merchant sells several clothing families and gives no clear
  // category/name yet, surface a useful combined clothing pool. Bags stay
  // out of this broad fallback unless they are the only sizeable subtype,
  // because S/M/L bags would muddy apparel entry for mixed stores.
  const clothingContexts = pieceContexts.filter((ctx) =>
    ['kids_clothing', 'men_clothing', 'women_clothing'].includes(ctx),
  );
  if (clothingContexts.length > 0) return 'none';

  return 'none';
}

// Returns the chip suggestions for the current Add Article context.
// Order matters: UoM-specific rules (pack / meter / dozen) come first,
// then deterministic fashion context, then category/name rules for shop.
function getRawSizeSuggestions(input: SizeSuggestionInput): readonly string[] {
  const { storeType, unit, category, sizeStandard, articleName } = input;
  const cat = normaliseToken(category);
  const name = articleName.trim();

  if (unit === 'pack') return PACK_COUNTS;
  if (unit === 'meter') return METER_LENGTHS;
  if (unit === 'dozen') return DOZEN_COUNTS;

  if (storeType === 'fashion') {
    const context = inferFashionSizeContext(input);

    // Men's trousers are a special case: still men's clothing, but numeric
    // waist chips are more useful than S/M/L.
    if (context === 'men_clothing' && TROUSER_CATEGORIES.has(cat)) return MEN_PANT_SIZES;

    if (NON_FASHION_BAG_NAME_HINTS.test(name)) return [];

    // If mixed clothing without category/name returns 'none', provide a
    // deduped union of selected clothing chips so Add Article still feels
    // helpful while preserving free-text entry for everything else.
    if (context === 'none' && unit === 'piece') {
      const selected = selectedPieceContexts(input.fashionSubtypes).filter((ctx) =>
        ['kids_clothing', 'men_clothing', 'women_clothing'].includes(ctx),
      );
      if (selected.length > 1) {
        return dedupe(selected.flatMap((ctx) => suggestionsForContext(ctx, sizeStandard)));
      }
    }

    return suggestionsForContext(context, sizeStandard);
  }

  if (unit === 'piece') {
    if (cat === 'beverages' || cat === 'beverage' || cat === 'drinks') return BEVERAGE_VOLUMES;
    if (cat === 'food' || cat === 'food_beverages') return FOOD_WEIGHTS;
    if (cat === 'powder') return FOOD_WEIGHTS;

    if (BEVERAGE_NAME_HINTS.test(name)) return BEVERAGE_VOLUMES;
    if (FOOD_WEIGHT_NAME_HINTS.test(name)) return FOOD_WEIGHTS;
  }

  return [];
}

// Public API used by Add Article. Large mixed-fashion profiles can produce a
// noisy union of chips (men + women + kids clothing). Cap the visible chip rail
// so mobile stays readable; free-text size entry remains available for every
// product.
export function getSizeSuggestions(input: SizeSuggestionInput): readonly string[] {
  const suggestions = getRawSizeSuggestions(input);

  if (suggestions.length <= MAX_SIZE_SUGGESTIONS) {
    return suggestions;
  }

  const context = input.storeType === 'fashion' ? inferFashionSizeContext(input) : 'none';
  const isBroadClothingContext =
    input.storeType === 'fashion' &&
    input.unit === 'piece' &&
    (context === 'none' ||
      context === 'men_clothing' ||
      context === 'women_clothing' ||
      context === 'kids_clothing');

  if (isBroadClothingContext) {
    return GENERIC_CLOTHING_FALLBACK;
  }

  return suggestions;
}

// Backwards-compatible explicit API for callers that want the capped chip rail
// name. getSizeSuggestions() is already capped; this alias documents the UI
// contract without changing existing imports.
export function getSizeSuggestionsCapped(input: SizeSuggestionInput): readonly string[] {
  return getSizeSuggestions(input);
}

export function formatSizeChip(chip: string, locale: string): string {
  const language = locale.split('-')[0]?.toLowerCase() ?? 'en';
  if (chip === 'One size') {
    const translations: Record<string, string> = {
      ar: 'مقاس واحد',
      fr: 'Taille unique',
      en: 'One size',
    };
    return translations[language] ?? chip;
  }

  // Keep quantities and measurement-like chips stable. These are product data
  // hints, not UI labels, and merchants recognise them as-is.
  if (
    chip.includes('-pack') ||
    chip.includes('dozen') ||
    /^\d+(?:\.\d+)?(?:ml|l|g|kg|m)$/i.test(chip)
  ) {
    return chip;
  }

  return chip;
}
