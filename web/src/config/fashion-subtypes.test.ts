import { describe, expect, it } from 'vitest';
import {
  FASHION_SUBTYPE_CONFIG,
  FASHION_SUBTYPE_ORDER,
  SIZE_HINT_VALUES,
  categoriesForFashionSubtypes,
  getFashionSubtypeConfig,
  sizeHintValuesForSubtypes,
} from './fashion-subtypes';

describe('FASHION_SUBTYPE_CONFIG', () => {
  it('order has 8 predefined entries', () => {
    expect(FASHION_SUBTYPE_ORDER.length).toBe(8);
  });

  it('every order entry has a matching config row', () => {
    for (const key of FASHION_SUBTYPE_ORDER) {
      expect(FASHION_SUBTYPE_CONFIG[key]).toBeDefined();
    }
  });

  it('every config entry has label_key, desc_key, categories, size_hint', () => {
    for (const cfg of Object.values(FASHION_SUBTYPE_CONFIG)) {
      expect(cfg.label_key).toMatch(/_label$/);
      expect(cfg.desc_key).toMatch(/_desc$/);
      expect(cfg.categories.length).toBeGreaterThan(0);
      expect(SIZE_HINT_VALUES).toHaveProperty(cfg.size_hint);
    }
  });
});

describe('categoriesForFashionSubtypes', () => {
  it('returns deduplicated union of categories across selected subtypes', () => {
    expect(categoriesForFashionSubtypes(['shoes', 'shoes_kids'])).toEqual([
      'sport',
      'dress',
      'casual',
      'school',
    ]);
  });

  it('returns empty for empty input', () => {
    expect(categoriesForFashionSubtypes([])).toEqual([]);
  });

  it('skips unknown (custom) subtype strings', () => {
    expect(categoriesForFashionSubtypes(['custom_zone', 'shoes'])).toEqual([
      'sport',
      'dress',
      'casual',
    ]);
  });
});

describe('sizeHintValuesForSubtypes', () => {
  it('returns the EU shoe size set for shoes', () => {
    const out = sizeHintValuesForSubtypes(['shoes']);
    expect(out).toContain('36');
    expect(out).toContain('46');
    expect(out).not.toContain('XS');
  });

  it('returns letter sizes for clothing_men', () => {
    const out = sizeHintValuesForSubtypes(['clothing_men']);
    expect(out).toContain('XS');
    expect(out).toContain('XXXL');
    expect(out).not.toContain('36');
  });

  it('combines numeric_eu + letter for shoes + clothing_men selection', () => {
    const out = sizeHintValuesForSubtypes(['shoes', 'clothing_men']);
    expect(out).toContain('36');
    expect(out).toContain('XS');
  });

  it('returns empty for accessories / bags / jewelry (size_hint=none)', () => {
    expect(sizeHintValuesForSubtypes(['accessories'])).toEqual([]);
    expect(sizeHintValuesForSubtypes(['bags'])).toEqual([]);
    expect(sizeHintValuesForSubtypes(['jewelry'])).toEqual([]);
    expect(sizeHintValuesForSubtypes(['accessories', 'bags', 'jewelry'])).toEqual([]);
  });

  it('age values for clothing_kids', () => {
    const out = sizeHintValuesForSubtypes(['clothing_kids']);
    expect(out).toContain('3M');
    expect(out).toContain('12Y');
  });
});

describe('getFashionSubtypeConfig', () => {
  it('returns the config for predefined keys', () => {
    expect(getFashionSubtypeConfig('shoes')?.size_hint).toBe('numeric_eu');
  });

  it('returns undefined for custom strings', () => {
    expect(getFashionSubtypeConfig('halal_meat')).toBeUndefined();
  });
});
