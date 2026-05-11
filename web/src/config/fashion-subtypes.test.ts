import { describe, expect, it } from 'vitest';
import {
  FASHION_SUBTYPE_CONFIG,
  FASHION_SUBTYPE_ORDER,
  SHOP_PACKAGE_SIZES,
  SIZE_HINT_VALUES,
  categoriesForFashionSubtypes,
  getFashionSubtypeConfig,
  sizeHintValuesForCategory,
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

describe('sizeHintValuesForCategory (v0.5.6 ADR-026)', () => {
  it('returns letter sizes when category=shirts on a shoes+clothing_men profile', () => {
    // The article is a shirt; shoes EU sizes shouldn't pollute the
    // datalist even though shoes is also selected on the profile.
    const out = sizeHintValuesForCategory(['shoes', 'clothing_men'], 'shirts');
    expect(out).toContain('S');
    expect(out).toContain('M');
    expect(out).toContain('XXXL');
    expect(out).not.toContain('36');
    expect(out).not.toContain('46');
  });

  it('returns EU shoe sizes when category=sport on a shoes-only profile', () => {
    const out = sizeHintValuesForCategory(['shoes'], 'sport');
    expect(out).toContain('36');
    expect(out).toContain('46');
    expect(out).not.toContain('S');
  });

  it("returns the UNION of matching sub-types' hints when category sits in multiple", () => {
    // 'sport' lives in both shoes + shoes_kids — the merchant who
    // stocks both should see EU adult AND kids size chips for a
    // sport article.
    const out = sizeHintValuesForCategory(['shoes', 'shoes_kids'], 'sport');
    expect(out).toContain('36');
    expect(out).toContain('46');
    expect(out).toContain('20');
    expect(out).toContain('32');
  });

  it('falls back to all-sub-types union when category is empty', () => {
    const all = sizeHintValuesForSubtypes(['shoes', 'clothing_men']);
    expect(sizeHintValuesForCategory(['shoes', 'clothing_men'], '')).toEqual(all);
    expect(sizeHintValuesForCategory(['shoes', 'clothing_men'], null)).toEqual(all);
    expect(sizeHintValuesForCategory(['shoes', 'clothing_men'], undefined)).toEqual(all);
  });

  it('falls back to all-sub-types union when the category is custom (no sub-type match)', () => {
    // 'tabac' is a custom category — not in any fashion sub-type's
    // categories list. Keep showing the broader pool rather than
    // emptying the datalist.
    const all = sizeHintValuesForSubtypes(['shoes', 'clothing_men']);
    expect(sizeHintValuesForCategory(['shoes', 'clothing_men'], 'tabac')).toEqual(all);
  });

  it('returns empty when sub-types resolve to size_hint=none (accessories etc.)', () => {
    expect(sizeHintValuesForCategory(['accessories'], 'scarves')).toEqual([]);
    expect(sizeHintValuesForCategory(['bags'], 'handbags')).toEqual([]);
  });
});

describe('SHOP_PACKAGE_SIZES (v0.5.6)', () => {
  it('matches the v0.5.6 brief exactly', () => {
    expect([...SHOP_PACKAGE_SIZES]).toEqual(['250ml', '500ml', '1L', '500g', '1Kg', '5Kg']);
  });
});
