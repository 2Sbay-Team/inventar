import { type ShopSubtype, type ShopSubtypePredefined } from '../types';

// v0.5 ADR-017 / v0.5.2 ADR-018: Shop sub-types. The merchant picks any
// combination at onboarding (multi-select, ≥1 required); the union of
// their selected sub-types' default categories becomes the suggestion
// list in Add Article + the new-product mini-form in /receive.
//
// `has_expiry_default` is a UX hint: when receiving a barcode under one
// of these sub-types, pre-focus the expiry input. Tobacco / stationery
// don't need it; food / personal care / pharmacy OTC do.
//
// `legacy: true` marks sub-types that existed in v0.5 but were retired
// from the predefined picker in v0.5.2 (per ADR-018: no regulated /
// sensitive categories pre-listed). They stay in the config so existing
// profiles keep their localised labels — the picker filters them out via
// SHOP_SUBTYPE_ORDER. Merchant can remove them but never re-add from the
// picker; if needed they can be added as custom strings.

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
  // v0.5.2: true for sub-types removed from the predefined picker.
  // Existing profiles preserve them and render the localised label;
  // new profiles only see the non-legacy ones in the chooser.
  legacy?: boolean;
}

// Type-keyed config: uses ShopSubtypePredefined ∪ legacy keys so we get
// exhaustiveness checking when adding a new predefined. Legacy keys are
// hand-written below; they're not in any union.
type ShopSubtypeKey = ShopSubtypePredefined | 'tobacco_lottery' | 'parapharmaceutique' | 'other';

export const SHOP_SUBTYPE_CONFIG: Record<ShopSubtypeKey, ShopSubtypeConfig> = {
  // v0.5.2 ADR-018: predefined set (14 entries). Order here is purely
  // for readability — SHOP_SUBTYPE_ORDER drives the picker.
  food_beverages: {
    label_key: 'food_beverages_label',
    desc_key: 'food_beverages_desc',
    categories: ['drinks', 'dry_goods', 'canned', 'condiments', 'oils'],
    has_expiry_default: true,
  },
  fresh_produce: {
    label_key: 'fresh_produce_label',
    desc_key: 'fresh_produce_desc',
    categories: ['fruits', 'vegetables', 'herbs'],
    has_expiry_default: true,
  },
  bakery_pastry: {
    label_key: 'bakery_pastry_label',
    desc_key: 'bakery_pastry_desc',
    categories: ['bread', 'pastry', 'cakes'],
    has_expiry_default: true,
  },
  snacks_confectionery: {
    label_key: 'snacks_confectionery_label',
    desc_key: 'snacks_confectionery_desc',
    categories: ['candy', 'chocolate', 'biscuits', 'chips'],
    has_expiry_default: true,
  },
  frozen_foods: {
    label_key: 'frozen_foods_label',
    desc_key: 'frozen_foods_desc',
    categories: ['frozen_meals', 'ice_cream', 'frozen_vegetables'],
    has_expiry_default: true,
  },
  personal_care: {
    label_key: 'personal_care_label',
    desc_key: 'personal_care_desc',
    categories: ['soap', 'shampoo', 'toothpaste', 'deodorant'],
    has_expiry_default: true,
  },
  cosmetics_beauty: {
    label_key: 'cosmetics_beauty_label',
    desc_key: 'cosmetics_beauty_desc',
    categories: ['makeup', 'perfume', 'beauty_tools'],
    has_expiry_default: true,
  },
  health_otc: {
    label_key: 'health_otc_label',
    desc_key: 'health_otc_desc',
    categories: ['vitamins', 'sunscreen', 'otc_medicines', 'first_aid'],
    has_expiry_default: true,
  },
  household_cleaning: {
    label_key: 'household_cleaning_label',
    desc_key: 'household_cleaning_desc',
    categories: ['detergent', 'cleaning', 'paper_goods'],
    has_expiry_default: false,
  },
  kitchenware_homegoods: {
    label_key: 'kitchenware_homegoods_label',
    desc_key: 'kitchenware_homegoods_desc',
    categories: ['kitchen', 'utensils', 'storage'],
    has_expiry_default: false,
  },
  stationery: {
    label_key: 'stationery_label',
    desc_key: 'stationery_desc',
    categories: ['notebooks', 'pens', 'school'],
    has_expiry_default: false,
  },
  toys_baby: {
    label_key: 'toys_baby_label',
    desc_key: 'toys_baby_desc',
    categories: ['toys', 'baby_food', 'diapers'],
    has_expiry_default: true,
  },
  pet_supplies: {
    label_key: 'pet_supplies_label',
    desc_key: 'pet_supplies_desc',
    categories: ['pet_food', 'pet_accessories'],
    has_expiry_default: true,
  },
  electronics_accessories: {
    label_key: 'electronics_accessories_label',
    desc_key: 'electronics_accessories_desc',
    categories: ['phone_accessories', 'batteries', 'chargers'],
    has_expiry_default: false,
  },
  // v0.5.2: legacy entries (kept for back-compat readability; not in
  // SHOP_SUBTYPE_ORDER so they don't appear in the new picker).
  tobacco_lottery: {
    label_key: 'tobacco_lottery_label',
    desc_key: 'tobacco_lottery_desc',
    categories: ['tobacco', 'lottery', 'phone_credit'],
    has_expiry_default: false,
    legacy: true,
  },
  parapharmaceutique: {
    label_key: 'parapharmaceutique_label',
    desc_key: 'parapharmaceutique_desc',
    categories: ['vitamins', 'sunscreen', 'cosmetics', 'first_aid', 'baby_care'],
    has_expiry_default: true,
    legacy: true,
  },
  other: {
    label_key: 'other_label',
    desc_key: 'other_desc',
    categories: ['other'],
    has_expiry_default: false,
    legacy: true,
  },
};

// Display order for the onboarding + Settings picker. v0.5.2 ADR-018:
// only the 14 predefined entries — legacy keys are excluded so new
// profiles can't pick them. Existing profiles' chips render via
// SHOP_SUBTYPE_CONFIG lookup regardless of order.
export const SHOP_SUBTYPE_ORDER: readonly ShopSubtypePredefined[] = [
  'food_beverages',
  'fresh_produce',
  'bakery_pastry',
  'snacks_confectionery',
  'frozen_foods',
  'personal_care',
  'cosmetics_beauty',
  'health_otc',
  'household_cleaning',
  'kitchenware_homegoods',
  'stationery',
  'toys_baby',
  'pet_supplies',
  'electronics_accessories',
];

// v0.5.2: returns the config row for any sub-type key, predefined or
// legacy. Returns undefined for fully custom strings — callers should
// fall back to displaying the raw string verbatim.
export function getSubtypeConfig(subtype: ShopSubtype): ShopSubtypeConfig | undefined {
  return (SHOP_SUBTYPE_CONFIG as Record<string, ShopSubtypeConfig>)[subtype];
}

// Returns the de-duplicated union of category strings for the given
// sub-types. Order is the union-by-first-appearance traversal order, which
// keeps the most-likely categories of the most-likely sub-type at the top.
// Custom strings (no entry in SHOP_SUBTYPE_CONFIG) contribute no
// categories.
export function categoriesForSubtypes(subtypes: readonly ShopSubtype[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const st of subtypes) {
    const cfg = getSubtypeConfig(st);
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

// True if any selected sub-type defaults expiry on. Drives the
// pre-focused expiry input in /receive's bottom sheet. Custom strings
// default to false (we don't know their expiry shape).
export function shouldDefaultExpiry(subtypes: readonly ShopSubtype[]): boolean {
  return subtypes.some((st) => getSubtypeConfig(st)?.has_expiry_default === true);
}
