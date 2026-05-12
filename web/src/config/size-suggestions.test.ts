import { describe, expect, it } from 'vitest';
import { getSizeSuggestions } from './size-suggestions';

// Helper to spread a fashion-shaped base so each test stays focused on
// the axes it cares about.
function fashion(overrides: Partial<Parameters<typeof getSizeSuggestions>[0]>) {
  return getSizeSuggestions({
    storeType: 'fashion',
    fashionSubtypes: ['shoes'],
    unit: 'pair',
    category: '',
    sizeStandard: 'EU',
    articleName: '',
    ...overrides,
  });
}

describe('getSizeSuggestions — weight/volume UoMs', () => {
  // The screen hides the size field for these; this helper conservatively
  // returns no chips too so nothing leaks if a future caller forgets the
  // hide guard. Spec tests N+1..N+4 — these UoMs never produce chips.
  for (const u of ['kg', 'g', 'l', 'ml'] as const) {
    it(`unit '${u}' → no chips`, () => {
      expect(fashion({ unit: u })).toEqual([]);
    });
  }
});

describe('getSizeSuggestions — shoes', () => {
  // N+5 + N+6 + companion UK/JP.
  it('fashion+shoes, pair, EU → 36-46 chips', () => {
    expect(fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'EU' })).toEqual([
      '36',
      '37',
      '38',
      '39',
      '40',
      '41',
      '42',
      '43',
      '44',
      '45',
      '46',
    ]);
  });

  it('fashion+shoes, pair, US → 6-13 chips', () => {
    expect(fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'US' })).toEqual([
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
    ]);
  });

  it('fashion+shoes, pair, UK → 3-12 chips', () => {
    expect(fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'UK' })).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  it('fashion+shoes, pair, JP → 22-30 chips (cm)', () => {
    expect(fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'JP' })).toEqual([
      '22',
      '23',
      '24',
      '25',
      '26',
      '27',
      '28',
      '29',
      '30',
    ]);
  });

  it('fashion+shoes_kids overrides adult shoes when both selected', () => {
    expect(fashion({ fashionSubtypes: ['shoes', 'shoes_kids'], unit: 'pair' })).toContain('20');
  });
});

describe('getSizeSuggestions — clothing', () => {
  it('men → XS-XXXL letter sizes', () => {
    expect(fashion({ fashionSubtypes: ['clothing_men'], unit: 'piece' })).toEqual([
      'XS',
      'S',
      'M',
      'L',
      'XL',
      'XXL',
      'XXXL',
    ]);
  });

  it('men + trousers → numeric pant sizes', () => {
    expect(
      fashion({ fashionSubtypes: ['clothing_men'], unit: 'piece', category: 'trousers' }),
    ).toContain('32');
  });

  it('women → letter + numeric sizes per standard', () => {
    const eu = fashion({ fashionSubtypes: ['clothing_women'], unit: 'piece', sizeStandard: 'EU' });
    expect(eu).toContain('XS');
    expect(eu).toContain('38');
    const us = fashion({ fashionSubtypes: ['clothing_women'], unit: 'piece', sizeStandard: 'US' });
    expect(us).toContain('XS');
    expect(us).toContain('6');
    expect(us).not.toContain('38');
  });

  it('kids → age sizes (3M, 2Y, ...)', () => {
    const chips = fashion({ fashionSubtypes: ['clothing_kids'], unit: 'piece' });
    expect(chips).toContain('3M');
    expect(chips).toContain('2Y');
    expect(chips).toContain('16Y');
  });
});

describe('getSizeSuggestions — accessories / jewelry / bags', () => {
  it('accessories + belts → centimetre chips', () => {
    expect(fashion({ fashionSubtypes: ['accessories'], unit: 'piece', category: 'belts' })).toEqual(
      ['80', '85', '90', '95', '100', '105', '110', '115', '120'],
    );
  });

  it('accessories + hats → single "One size" chip', () => {
    expect(fashion({ fashionSubtypes: ['accessories'], unit: 'piece', category: 'hats' })).toEqual([
      'One size',
    ]);
  });

  it('jewelry + rings, EU → 14-21 chips', () => {
    expect(fashion({ fashionSubtypes: ['jewelry'], unit: 'piece', category: 'rings' })).toContain(
      '17',
    );
  });

  it('bags → Small / Medium / Large', () => {
    expect(fashion({ fashionSubtypes: ['bags'], unit: 'piece' })).toEqual([
      'Small',
      'Medium',
      'Large',
    ]);
  });
});

describe('getSizeSuggestions — unit-driven rules', () => {
  it("unit 'pack' → 2-pack..24-pack", () => {
    expect(fashion({ unit: 'pack' })).toEqual([
      '2-pack',
      '4-pack',
      '6-pack',
      '10-pack',
      '12-pack',
      '24-pack',
    ]);
  });

  it("unit 'meter' → cut-length chips", () => {
    expect(fashion({ unit: 'meter' })).toEqual(['0.5m', '1m', '2m', '3m', '5m', '10m']);
  });

  it("unit 'dozen' → 1..3 dozen", () => {
    expect(fashion({ unit: 'dozen' })).toEqual(['1 dozen', '2 dozen', '3 dozen']);
  });
});

describe('getSizeSuggestions — shop name / category fallbacks', () => {
  it('shop + name "Bottled water" → beverage volumes', () => {
    expect(
      getSizeSuggestions({
        storeType: 'shop',
        fashionSubtypes: [],
        unit: 'piece',
        category: '',
        sizeStandard: 'EU',
        articleName: 'Bottled water',
      }),
    ).toContain('1L');
  });

  it('shop + category beverages → beverage volumes', () => {
    expect(
      getSizeSuggestions({
        storeType: 'shop',
        fashionSubtypes: [],
        unit: 'piece',
        category: 'beverages',
        sizeStandard: 'EU',
        articleName: 'Anything',
      }),
    ).toContain('500ml');
  });

  it('shop + name "Sugar powder" → food weights', () => {
    expect(
      getSizeSuggestions({
        storeType: 'shop',
        fashionSubtypes: [],
        unit: 'piece',
        category: '',
        sizeStandard: 'EU',
        articleName: 'Sugar powder',
      }),
    ).toContain('1kg');
  });

  it('shop + unrecognised category → no chips (free text only)', () => {
    expect(
      getSizeSuggestions({
        storeType: 'shop',
        fashionSubtypes: [],
        unit: 'piece',
        category: 'tabac',
        sizeStandard: 'EU',
        articleName: 'Marlboro',
      }),
    ).toEqual([]);
  });
});

describe('getSizeSuggestions — size_standard switches shoe chips', () => {
  it('switching EU → US flips the suggestion pool', () => {
    const eu = fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'EU' });
    const us = fashion({ fashionSubtypes: ['shoes'], unit: 'pair', sizeStandard: 'US' });
    expect(eu).not.toEqual(us);
    expect(eu).toContain('42');
    expect(us).toContain('9');
  });
});
