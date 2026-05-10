import { describe, expect, it } from 'vitest';
import {
  SHOP_SUBTYPE_CONFIG,
  SHOP_SUBTYPE_ORDER,
  categoriesForSubtypes,
  getSubtypeConfig,
  shouldDefaultExpiry,
} from './shop-subtypes';

describe('SHOP_SUBTYPE_CONFIG', () => {
  it('picker order has 14 predefined entries (v0.5.2 expansion)', () => {
    expect(SHOP_SUBTYPE_ORDER.length).toBe(14);
  });

  it('legacy keys (tobacco_lottery, parapharmaceutique, other) are NOT in picker order', () => {
    expect(SHOP_SUBTYPE_ORDER).not.toContain('tobacco_lottery');
    expect(SHOP_SUBTYPE_ORDER).not.toContain('parapharmaceutique');
    expect(SHOP_SUBTYPE_ORDER).not.toContain('other');
  });

  it('legacy keys are still in CONFIG (so existing-profile chips render with localised labels)', () => {
    expect(SHOP_SUBTYPE_CONFIG.tobacco_lottery).toBeDefined();
    expect(SHOP_SUBTYPE_CONFIG.tobacco_lottery.legacy).toBe(true);
    expect(SHOP_SUBTYPE_CONFIG.parapharmaceutique).toBeDefined();
    expect(SHOP_SUBTYPE_CONFIG.parapharmaceutique.legacy).toBe(true);
    expect(SHOP_SUBTYPE_CONFIG.other).toBeDefined();
    expect(SHOP_SUBTYPE_CONFIG.other.legacy).toBe(true);
  });

  it('predefined entries have NO legacy flag', () => {
    for (const key of SHOP_SUBTYPE_ORDER) {
      expect(SHOP_SUBTYPE_CONFIG[key].legacy).toBeUndefined();
    }
  });
});

describe('getSubtypeConfig', () => {
  it('returns config for predefined keys', () => {
    expect(getSubtypeConfig('food_beverages')?.has_expiry_default).toBe(true);
  });

  it('returns config for legacy keys (so chips can still render)', () => {
    expect(getSubtypeConfig('tobacco_lottery')?.label_key).toBe('tobacco_lottery_label');
  });

  it('returns undefined for custom strings', () => {
    expect(getSubtypeConfig('halal_meat')).toBeUndefined();
    expect(getSubtypeConfig('bio_organic')).toBeUndefined();
  });
});

describe('categoriesForSubtypes', () => {
  it('returns deduplicated union for multiple selected subtypes', () => {
    const out = categoriesForSubtypes(['fresh_produce', 'bakery_pastry']);
    expect(out).toEqual(['fruits', 'vegetables', 'herbs', 'bread', 'pastry', 'cakes']);
  });

  it('skips unknown / custom strings (no contribution)', () => {
    expect(categoriesForSubtypes(['halal_meat', 'food_beverages'])).toEqual([
      'drinks',
      'dry_goods',
      'canned',
      'condiments',
      'oils',
    ]);
  });

  it('legacy keys still contribute their categories (back-compat for existing profiles)', () => {
    expect(categoriesForSubtypes(['tobacco_lottery'])).toEqual([
      'tobacco',
      'lottery',
      'phone_credit',
    ]);
  });
});

describe('shouldDefaultExpiry', () => {
  it('returns true when any selected predefined defaults to expiry', () => {
    expect(shouldDefaultExpiry(['food_beverages', 'stationery'])).toBe(true);
  });

  it('returns false when no selected subtype defaults to expiry', () => {
    expect(shouldDefaultExpiry(['stationery', 'electronics_accessories'])).toBe(false);
  });

  it('custom strings do not contribute (return false unless something else is set)', () => {
    expect(shouldDefaultExpiry(['halal_meat'])).toBe(false);
  });
});
