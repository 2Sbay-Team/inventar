import { type StoreType } from '../types';

// Per-store-type configuration: which categories to suggest, whether
// articles need sizes, and a flag emoji + key for i18n display.
//
// `categories` is the list shown in Add Article. Stored category strings
// stay free-form (Article.category: string) so a user can switch store
// type later without breaking historical articles.
//
// v0.5 ADR-017: 'kiosk' and 'grocery' merged into 'shop'. Shop articles
// gain expiry tracking and barcode-driven scan flows (/receive, /sell);
// see config/shop-subtypes.ts for the per-merchant sub-categorisation
// that drives the default category list for shop.

export interface StoreTypeConfig {
  // True for stores where each article has multiple sized variants
  // (shoes, clothes). False for shop, where one article = one stock unit.
  has_sizes: boolean;
  // True for stores where each article has multiple colour variants
  // (shoes, clothes). False for shop. v0.3 ADR-011: drives whether Add
  // Article shows per-colour blocks and whether Article Detail renders
  // the colour × size matrix.
  has_colors: boolean;
  // v0.5 ADR-019: true if this vertical's articles can have lots with
  // expiry dates. Drives whether /receive shows the optional expiry
  // input and whether the dashboard's "Expiring soon" widget renders.
  has_expiry: boolean;
  // v0.5 ADR-018: 'add' = Add Article is the primary entry; 'scan' =
  // /receive and /sell are the primary entries. Shop is scan-first;
  // shoes / clothes stay add-first. Drives the bottom-nav layout.
  primary_flow: 'add' | 'scan';
  // Suggested category list shown in the Add Article picker. For shop,
  // this is the fallback when the merchant hasn't picked any sub-types
  // yet; otherwise the union of selected sub-types' categories wins
  // (see shop-subtypes.ts).
  categories: readonly string[];
  // Single emoji shown in the onboarding card. Pure visual hint; no
  // semantic meaning for the data layer.
  flag: string;
  // i18n key under the `store_types` namespace for the label.
  label_key: string;
  // Short i18n key for the one-line description shown under each card.
  desc_key: string;
  // 2-letter prefix used for the auto-allocated internal_code on new
  // articles. Old articles keep whatever prefix they were created with —
  // the parser strips by '-' so prefix changes don't break sequencing.
  // Shop uses 'GR' (carried over from the legacy grocery prefix; the
  // v6→v7 migration leaves existing 'KI' codes on kiosk-origin articles
  // alone).
  sku_prefix: string;
}

export const STORE_TYPES: Record<StoreType, StoreTypeConfig> = {
  shoes: {
    has_sizes: true,
    has_colors: true,
    has_expiry: false,
    primary_flow: 'add',
    categories: ['sport', 'dress', 'casual', 'kids', 'women', 'men'],
    flag: '👟',
    label_key: 'shoes_label',
    desc_key: 'shoes_desc',
    sku_prefix: 'SH',
  },
  clothes: {
    has_sizes: true,
    has_colors: true,
    has_expiry: false,
    primary_flow: 'add',
    categories: ['shirts', 'pants', 'dresses', 'kids', 'women', 'men', 'accessories'],
    flag: '👕',
    label_key: 'clothes_label',
    desc_key: 'clothes_desc',
    sku_prefix: 'CL',
  },
  shop: {
    has_sizes: false,
    has_colors: false,
    has_expiry: true,
    primary_flow: 'scan',
    // Fallback categories when no sub-types are selected. The onboarding
    // step requires ≥1 sub-type, so this list rarely surfaces in
    // practice — kept as a safety net for legacy v6 rows pre-migration.
    categories: ['food', 'drinks', 'snacks', 'household', 'personal_care', 'other'],
    flag: '🏪',
    label_key: 'shop_label',
    desc_key: 'shop_desc',
    sku_prefix: 'GR',
  },
};

export const STORE_TYPE_ORDER: readonly StoreType[] = ['shoes', 'clothes', 'shop'];
