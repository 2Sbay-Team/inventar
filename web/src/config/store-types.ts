import { type StoreType } from '../types';

// Per-store-type configuration: which categories to suggest, whether
// articles need sizes, and a flag emoji + key for i18n display.
//
// `categories` is the list shown in Add Article. Stored category strings
// stay free-form (Article.category: string) so a user can switch store
// type later without breaking historical articles.

export interface StoreTypeConfig {
  // True for stores where one article = one stock unit (kiosk, grocery).
  // False for stores where each article has multiple sized variants
  // (shoes, clothes).
  has_sizes: boolean;
  // Suggested category list shown in the Add Article picker.
  categories: readonly string[];
  // Single emoji shown in the onboarding card. Pure visual hint; no
  // semantic meaning for the data layer.
  flag: string;
  // i18n key under the `store_types` namespace for the label.
  label_key: string;
  // Short i18n key for the one-line description shown under each card.
  desc_key: string;
}

export const STORE_TYPES: Record<StoreType, StoreTypeConfig> = {
  shoes: {
    has_sizes: true,
    categories: ['sport', 'dress', 'casual', 'kids', 'women', 'men'],
    flag: '👟',
    label_key: 'shoes_label',
    desc_key: 'shoes_desc',
  },
  clothes: {
    has_sizes: true,
    categories: ['shirts', 'pants', 'dresses', 'kids', 'women', 'men', 'accessories'],
    flag: '👕',
    label_key: 'clothes_label',
    desc_key: 'clothes_desc',
  },
  kiosk: {
    has_sizes: false,
    categories: ['drinks', 'snacks', 'tobacco', 'magazines', 'phone_credit', 'other'],
    flag: '🏪',
    label_key: 'kiosk_label',
    desc_key: 'kiosk_desc',
  },
  grocery: {
    has_sizes: false,
    categories: ['produce', 'dairy', 'dry_goods', 'frozen', 'beverages', 'other'],
    flag: '🛒',
    label_key: 'grocery_label',
    desc_key: 'grocery_desc',
  },
};

export const STORE_TYPE_ORDER: readonly StoreType[] = ['shoes', 'clothes', 'kiosk', 'grocery'];
