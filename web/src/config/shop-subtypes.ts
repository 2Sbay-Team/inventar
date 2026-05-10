import { type ShopSubtype } from '../types';

// v0.5 ADR-017: Shop sub-types. The merchant picks any combination at
// onboarding (multi-select, ≥1 required); the union of their selected
// sub-types' default categories becomes the suggestion list in Add
// Article + the new-product mini-form in /receive.
//
// `has_expiry_default` is a UX hint: when receiving a barcode under one
// of these sub-types, pre-focus the expiry input. Tobacco / stationery
// don't need it; food / personal care / parapharma do.

export interface ShopSubtypeConfig {
  // i18n key under the `shop_subtypes` namespace for the chip label.
  label_key: string;
  // Short i18n key for the one-line description under each chip.
  desc_key: string;
  // Default categories suggested in Add Article when this sub-type is
  // selected. Union across all selected sub-types is the fallback list
  // for the merchant; they can still type any free-form category.
  categories: readonly string[];
  // Whether items in this sub-type typically carry an expiry date.
  // Drives whether /receive's expiry input gets pre-focused.
  has_expiry_default: boolean;
}

export const SHOP_SUBTYPE_CONFIG: Record<ShopSubtype, ShopSubtypeConfig> = {
  food_beverages: {
    label_key: 'food_beverages_label',
    desc_key: 'food_beverages_desc',
    categories: ['produce', 'dairy', 'dry_goods', 'frozen', 'beverages', 'bakery'],
    has_expiry_default: true,
  },
  tobacco_lottery: {
    label_key: 'tobacco_lottery_label',
    desc_key: 'tobacco_lottery_desc',
    categories: ['tobacco', 'lottery', 'phone_credit'],
    has_expiry_default: false,
  },
  snacks_confectionery: {
    label_key: 'snacks_confectionery_label',
    desc_key: 'snacks_confectionery_desc',
    categories: ['snacks', 'candy', 'chocolate', 'biscuits'],
    has_expiry_default: true,
  },
  personal_care: {
    label_key: 'personal_care_label',
    desc_key: 'personal_care_desc',
    categories: ['hair', 'skin', 'oral', 'deodorant', 'shaving'],
    has_expiry_default: true,
  },
  household_cleaning: {
    label_key: 'household_cleaning_label',
    desc_key: 'household_cleaning_desc',
    categories: ['detergent', 'bleach', 'sponges', 'paper_goods', 'kitchen'],
    has_expiry_default: false,
  },
  parapharmaceutique: {
    label_key: 'parapharmaceutique_label',
    desc_key: 'parapharmaceutique_desc',
    categories: ['vitamins', 'sunscreen', 'cosmetics', 'first_aid', 'baby_care'],
    has_expiry_default: true,
  },
  stationery: {
    label_key: 'stationery_label',
    desc_key: 'stationery_desc',
    categories: ['notebooks', 'pens', 'school', 'office'],
    has_expiry_default: false,
  },
  other: {
    label_key: 'other_label',
    desc_key: 'other_desc',
    categories: ['other'],
    has_expiry_default: false,
  },
};

// Display order for the onboarding picker — common first, "other" last.
export const SHOP_SUBTYPE_ORDER: readonly ShopSubtype[] = [
  'food_beverages',
  'tobacco_lottery',
  'snacks_confectionery',
  'personal_care',
  'household_cleaning',
  'parapharmaceutique',
  'stationery',
  'other',
];

// Returns the de-duplicated union of category strings for the given
// sub-types. Order is the union-by-first-appearance traversal order, which
// keeps the most-likely categories of the most-likely sub-type at the top.
export function categoriesForSubtypes(subtypes: readonly ShopSubtype[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of subtypes) {
    for (const c of SHOP_SUBTYPE_CONFIG[st].categories) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

// True if any selected sub-type defaults expiry on. Drives the
// pre-focused expiry input in /receive's bottom sheet.
export function shouldDefaultExpiry(subtypes: readonly ShopSubtype[]): boolean {
  return subtypes.some((st) => SHOP_SUBTYPE_CONFIG[st].has_expiry_default);
}
