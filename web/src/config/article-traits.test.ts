import { describe, expect, it } from 'vitest';
import {
  articleHasColors,
  articleHasExpiry,
  articleHasSizes,
  defaultUomForProfile,
  formatQtyString,
  formatQtyWithUom,
  inputPriceToInternal,
  inputQtyToInternal,
  internalPriceToInput,
  isContinuousUom,
  uomSmallUnitFactor,
} from './article-traits';
import { type Article, type ShopProfile } from '../types';

const baseArticle: Article = {
  id: 'a',
  internal_code: 'FN-0001',
  name: 'X',
  photo_id: null,
  category: 'sport',
  colors: [],
  brand: null,
  cost_price_tnd: 0,
  sale_price_tnd: 0,
  notes: null,
  barcode_ean: null,
  min_stock_threshold: null,
  expiry_alert_days: null,
  has_sizes: null,
  has_colors: null,
  has_expiry: null,
  unit_of_measure: 'piece',
  search_blob: '',
  updated_at: '2026-05-11T00:00:00.000Z',
  archived_at: null,
  deleted_at: null,
};

const fashionProfile: ShopProfile = {
  id: 'singleton',
  name: 'X',
  locale: 'fr',
  logo_photo_id: null,
  currency: 'TND',
  store_type: 'fashion',
  shop_subtypes: [],
  fashion_subtypes: ['shoes'],
  location_floor_label: 'Boutique',
  location_back_label: 'Réserve',
  expiry_warning_days: 7,
  legal_name: null,
  legal_address: null,
  fiscal_id: null,
  default_vat_pct: null,
  phone: null,
  qr_center_mode: 'name',
  tagline: null,
  description: null,
  address_street: null,
  address_city: null,
  address_country: null,
  whatsapp: null,
  email: null,
  website: null,
  instagram: null,
  facebook: null,
  tiktok: null,
  brand_primary_color: null,
  theme_bg_color: null,
  theme_mode: 'light',
  logo_dominant_color: null,
  opening_hours: null,
  created_at: '2026-05-11T00:00:00.000Z',
  updated_at: '2026-05-11T00:00:00.000Z',
  last_backup_at: null,
};

const shopProfile: ShopProfile = { ...fashionProfile, store_type: 'shop', fashion_subtypes: [] };

describe('articleHasSizes / Colors / Expiry — store_type fallback', () => {
  it('null override on fashion vertical → true for sizes + colors, false for expiry', () => {
    expect(articleHasSizes(baseArticle, fashionProfile)).toBe(true);
    expect(articleHasColors(baseArticle, fashionProfile)).toBe(true);
    expect(articleHasExpiry(baseArticle, fashionProfile)).toBe(false);
  });

  it('null override on shop vertical → false for sizes + colors, true for expiry', () => {
    expect(articleHasSizes(baseArticle, shopProfile)).toBe(false);
    expect(articleHasColors(baseArticle, shopProfile)).toBe(false);
    expect(articleHasExpiry(baseArticle, shopProfile)).toBe(true);
  });
});

describe('articleHasSizes / Colors / Expiry — per-article overrides', () => {
  it('article-level true overrides shop vertical defaults', () => {
    const overridden: Article = {
      ...baseArticle,
      has_sizes: true,
      has_colors: true,
      has_expiry: true,
    };
    expect(articleHasSizes(overridden, shopProfile)).toBe(true);
    expect(articleHasColors(overridden, shopProfile)).toBe(true);
    expect(articleHasExpiry(overridden, shopProfile)).toBe(true);
  });

  it('article-level false overrides fashion vertical defaults', () => {
    const overridden: Article = {
      ...baseArticle,
      has_sizes: false,
      has_colors: false,
      has_expiry: false,
    };
    expect(articleHasSizes(overridden, fashionProfile)).toBe(false);
    expect(articleHasColors(overridden, fashionProfile)).toBe(false);
    expect(articleHasExpiry(overridden, fashionProfile)).toBe(false);
  });

  it('null profile falls back to shoes defaults (sized + coloured)', () => {
    expect(articleHasSizes(baseArticle, null)).toBe(true);
    expect(articleHasColors(baseArticle, null)).toBe(true);
    expect(articleHasExpiry(baseArticle, null)).toBe(false);
  });
});

describe('uomSmallUnitFactor', () => {
  it('returns 1 for piece/g/ml and 1000 for kg/l', () => {
    expect(uomSmallUnitFactor('piece')).toBe(1);
    expect(uomSmallUnitFactor('g')).toBe(1);
    expect(uomSmallUnitFactor('ml')).toBe(1);
    expect(uomSmallUnitFactor('kg')).toBe(1000);
    expect(uomSmallUnitFactor('l')).toBe(1000);
  });

  it('v0.5.6: returns 1 for the four new countable / length units', () => {
    expect(uomSmallUnitFactor('pair')).toBe(1);
    expect(uomSmallUnitFactor('pack')).toBe(1);
    expect(uomSmallUnitFactor('dozen')).toBe(1);
    expect(uomSmallUnitFactor('meter')).toBe(1);
  });
});

describe('inputPriceToInternal — merchant input → storage', () => {
  it('piece price passes through unchanged', () => {
    expect(inputPriceToInternal(15000, 'piece')).toBe(15000); // 15 TND/piece
  });

  it('kg price is divided by 1000 (per-gram storage)', () => {
    expect(inputPriceToInternal(15000, 'kg')).toBe(15); // 15 TND/kg → 15 mil/g
    expect(inputPriceToInternal(50000, 'kg')).toBe(50); // 50 TND/kg → 50 mil/g
  });

  it('g price stored as-is', () => {
    expect(inputPriceToInternal(15, 'g')).toBe(15);
  });

  it('l price divided by 1000 (per-ml storage)', () => {
    expect(inputPriceToInternal(2000, 'l')).toBe(2); // 2 TND/l → 2 mil/ml
  });

  it('rounds halves up', () => {
    expect(inputPriceToInternal(1499, 'kg')).toBe(1); // 1.499 TND/kg → 1 mil/g (rounded down)
    expect(inputPriceToInternal(1500, 'kg')).toBe(2); // 1.5 mil/g → rounds to 2
  });
});

describe('internalPriceToInput — storage → merchant display', () => {
  it('reverses inputPriceToInternal for kg / l', () => {
    expect(internalPriceToInput(15, 'kg')).toBe(15000);
    expect(internalPriceToInput(2, 'l')).toBe(2000);
  });

  it('passes through for piece / g / ml', () => {
    expect(internalPriceToInput(15000, 'piece')).toBe(15000);
    expect(internalPriceToInput(15, 'g')).toBe(15);
    expect(internalPriceToInput(2, 'ml')).toBe(2);
  });
});

describe('inputQtyToInternal — merchant qty → storage', () => {
  it('piece passes through, rounded', () => {
    expect(inputQtyToInternal(3, 'piece')).toBe(3);
    expect(inputQtyToInternal(3.4, 'piece')).toBe(3);
  });

  it('kg multiplied to grams', () => {
    expect(inputQtyToInternal(0.85, 'kg')).toBe(850);
    expect(inputQtyToInternal(1.25, 'kg')).toBe(1250);
  });

  it('l multiplied to ml', () => {
    expect(inputQtyToInternal(1.5, 'l')).toBe(1500);
  });

  it('g / ml stored as integer pass-through', () => {
    expect(inputQtyToInternal(500, 'g')).toBe(500);
    expect(inputQtyToInternal(250, 'ml')).toBe(250);
  });
});

describe('formatQtyWithUom — storage → display pair', () => {
  it('piece → no suffix', () => {
    expect(formatQtyWithUom(3, 'piece')).toEqual({ value: 3, suffix: '' });
  });

  it('g + ml stay in small unit', () => {
    expect(formatQtyWithUom(500, 'g')).toEqual({ value: 500, suffix: 'g' });
    expect(formatQtyWithUom(250, 'ml')).toEqual({ value: 250, suffix: 'ml' });
  });

  it('kg < 1000g shown as g; ≥ 1000g shown as kg', () => {
    expect(formatQtyWithUom(850, 'kg')).toEqual({ value: 850, suffix: 'g' });
    expect(formatQtyWithUom(1250, 'kg')).toEqual({ value: 1.25, suffix: 'kg' });
    expect(formatQtyWithUom(1000, 'kg')).toEqual({ value: 1, suffix: 'kg' });
  });

  it('l < 1000ml shown as ml; ≥ 1000ml shown as l', () => {
    expect(formatQtyWithUom(500, 'l')).toEqual({ value: 500, suffix: 'ml' });
    expect(formatQtyWithUom(1500, 'l')).toEqual({ value: 1.5, suffix: 'l' });
  });

  it('v0.5.6: pair / pack / dozen / meter render as bare integer (no suffix)', () => {
    // The unit context lives in the dropdown next to the value, not in
    // a suffix — keeps the number readable and avoids plural-rule
    // gymnastics across the three locales.
    expect(formatQtyWithUom(3, 'pair')).toEqual({ value: 3, suffix: '' });
    expect(formatQtyWithUom(2, 'pack')).toEqual({ value: 2, suffix: '' });
    expect(formatQtyWithUom(5, 'dozen')).toEqual({ value: 5, suffix: '' });
    expect(formatQtyWithUom(7, 'meter')).toEqual({ value: 7, suffix: '' });
  });

  it('falls back to piece-like display for undefined / unknown uom (defensive)', () => {
    // Pre-v12 rows or fashion variants can carry an undefined or
    // legacy-string uom value past the TS type at runtime. Without a
    // default branch the function returned undefined and every caller
    // destructuring `{ value, suffix }` crashed its screen via the
    // ErrorBoundary ("Cannot destructure property 'value' of …
    // undefined" / WebKit's "Right side of assignment cannot be
    // destructured"). The dashboard, alerts banner, quick-adjust sheet
    // and search results card all read this function.
    expect(
      formatQtyWithUom(5, undefined as unknown as Parameters<typeof formatQtyWithUom>[1]),
    ).toEqual({ value: 5, suffix: '' });
    expect(
      formatQtyWithUom(3, 'bogus' as unknown as Parameters<typeof formatQtyWithUom>[1]),
    ).toEqual({ value: 3, suffix: '' });
  });
});

describe('formatQtyString — full display string', () => {
  it('piece → bare integer', () => {
    expect(formatQtyString(3, 'piece')).toBe('3');
  });

  it('kg / l trim trailing zeros', () => {
    expect(formatQtyString(1250, 'kg')).toBe('1.25 kg');
    expect(formatQtyString(1000, 'kg')).toBe('1 kg');
    expect(formatQtyString(850, 'kg')).toBe('850 g'); // < 1 kg falls back to g
    expect(formatQtyString(1500, 'l')).toBe('1.5 l');
  });

  it('g and ml stay integer with suffix', () => {
    expect(formatQtyString(500, 'g')).toBe('500 g');
    expect(formatQtyString(250, 'ml')).toBe('250 ml');
  });

  it('v0.5.6: pair / pack / dozen / meter render as bare integer', () => {
    expect(formatQtyString(3, 'pair')).toBe('3');
    expect(formatQtyString(2, 'pack')).toBe('2');
    expect(formatQtyString(5, 'dozen')).toBe('5');
    expect(formatQtyString(7, 'meter')).toBe('7');
  });
});

describe('isContinuousUom — measured vs countable distinction (v0.5.6)', () => {
  it('returns true for weight + volume + length UoMs', () => {
    expect(isContinuousUom('kg')).toBe(true);
    expect(isContinuousUom('g')).toBe(true);
    expect(isContinuousUom('l')).toBe(true);
    expect(isContinuousUom('ml')).toBe(true);
    expect(isContinuousUom('meter')).toBe(true);
  });

  it('returns false for countable units (a "pair" of shoes still has sizes)', () => {
    expect(isContinuousUom('piece')).toBe(false);
    expect(isContinuousUom('pair')).toBe(false);
    expect(isContinuousUom('pack')).toBe(false);
    expect(isContinuousUom('dozen')).toBe(false);
  });
});

describe('defaultUomForProfile — Add Article initial Unit (v0.5.6)', () => {
  function fashion(subs: string[]): ShopProfile {
    return { ...fashionProfile, fashion_subtypes: subs };
  }

  it('returns piece on a null / undefined profile', () => {
    expect(defaultUomForProfile(null)).toBe('piece');
    expect(defaultUomForProfile(undefined)).toBe('piece');
  });

  it('returns piece for shop vertical', () => {
    expect(defaultUomForProfile(shopProfile)).toBe('piece');
  });

  it('returns pair when the profile stocks ONLY adult shoes', () => {
    expect(defaultUomForProfile(fashion(['shoes']))).toBe('pair');
  });

  it('returns pair when the profile stocks ONLY kids shoes', () => {
    expect(defaultUomForProfile(fashion(['shoes_kids']))).toBe('pair');
  });

  it('returns pair when both shoes-related sub-types are selected', () => {
    expect(defaultUomForProfile(fashion(['shoes', 'shoes_kids']))).toBe('pair');
  });

  it('returns piece when ONLY clothing_men is selected', () => {
    expect(defaultUomForProfile(fashion(['clothing_men']))).toBe('piece');
  });

  it('returns piece when the merchant has mixed shoes + clothing sub-types', () => {
    // Mixed defaults to piece on purpose: a fashion merchant adding a
    // shirt should not see the unit default to "Pair" silently.
    expect(defaultUomForProfile(fashion(['shoes', 'clothing_men']))).toBe('piece');
  });

  it('returns piece for an empty sub-types array', () => {
    expect(defaultUomForProfile(fashion([]))).toBe('piece');
  });
});
