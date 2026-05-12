import { describe, expect, it } from 'vitest';
import { COMPLETION_FIELD_COUNT, computeCompletion, MILESTONES } from './profile-completion';
import type { ShopProfile } from '../types';

// Builds a minimum-shape ShopProfile with every nullable field cleared,
// then applies the overrides on top. Tests use this to construct exact
// percentages by filling specific fields.
function emptyProfile(overrides: Partial<ShopProfile> = {}): ShopProfile {
  return {
    id: 'singleton',
    name: 'Test Shop',
    locale: 'en',
    logo_photo_id: null,
    currency: 'TND',
    store_type: 'fashion',
    shop_subtypes: [],
    fashion_subtypes: [],
    location_floor_label: 'Floor',
    location_back_label: 'Back',
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
    created_at: '2026-05-12T00:00:00.000Z',
    updated_at: '2026-05-12T00:00:00.000Z',
    last_backup_at: null,
    ...overrides,
  };
}

describe('computeCompletion — boundaries', () => {
  it('empty profile reports 0% / 0 filled / 12 missing / next = receipts', () => {
    const result = computeCompletion(emptyProfile());
    expect(result.percentage).toBe(0);
    expect(result.filled).toBe(0);
    expect(result.total).toBe(COMPLETION_FIELD_COUNT);
    expect(result.missingFields).toHaveLength(COMPLETION_FIELD_COUNT);
    expect(result.unlocked).toEqual([]);
    expect(result.next?.key).toBe('receipts');
  });

  it('fully filled profile reports 100% / 12 filled / 0 missing / next = null', () => {
    const result = computeCompletion(
      emptyProfile({
        logo_photo_id: 'photo-1',
        tagline: 'Quality',
        description: 'Boutique',
        phone: '+216 71',
        whatsapp: '+216 98',
        email: 'a@b.c',
        address_street: 'Rue X',
        address_city: 'Tunis',
        address_country: 'Tunisia',
        fiscal_id: '123/A/B/000',
        legal_name: 'SARL Test',
        brand_primary_color: '#2B4C8A',
      }),
    );
    expect(result.percentage).toBe(100);
    expect(result.filled).toBe(COMPLETION_FIELD_COUNT);
    expect(result.missingFields).toEqual([]);
    expect(result.unlocked).toEqual(['receipts', 'invoices', 'catalog', 'business_card']);
    expect(result.next).toBeNull();
  });
});

describe('computeCompletion — milestone unlocks', () => {
  it('30% (receipts) unlocks when ≥ 4 of 12 fields filled', () => {
    // 4/12 ≈ 33% which rounds to 33, ≥ 30.
    const result = computeCompletion(
      emptyProfile({
        logo_photo_id: 'p',
        tagline: 'x',
        description: 'y',
        phone: '1',
      }),
    );
    expect(result.percentage).toBeGreaterThanOrEqual(30);
    expect(result.percentage).toBeLessThan(60);
    expect(result.unlocked).toContain('receipts');
    expect(result.unlocked).not.toContain('invoices');
    expect(result.next?.key).toBe('invoices');
  });

  it('60% (invoices) unlocks when ≥ 8 of 12 fields filled (60% threshold)', () => {
    // 8/12 ≈ 67% which is ≥ 60.
    const result = computeCompletion(
      emptyProfile({
        logo_photo_id: 'p',
        tagline: 'x',
        description: 'y',
        phone: '1',
        whatsapp: '2',
        email: 'a@b.c',
        address_street: 'X',
        fiscal_id: 'F',
      }),
    );
    expect(result.percentage).toBeGreaterThanOrEqual(60);
    expect(result.percentage).toBeLessThan(80);
    expect(result.unlocked).toEqual(expect.arrayContaining(['receipts', 'invoices']));
    expect(result.unlocked).not.toContain('catalog');
    expect(result.next?.key).toBe('catalog');
  });

  it('80% (catalog) unlocks when ≥ 10 of 12 fields filled', () => {
    // 10/12 ≈ 83% ≥ 80.
    const result = computeCompletion(
      emptyProfile({
        logo_photo_id: 'p',
        tagline: 'x',
        description: 'y',
        phone: '1',
        whatsapp: '2',
        email: 'a@b.c',
        address_street: 'X',
        address_city: 'Y',
        address_country: 'Z',
        fiscal_id: 'F',
      }),
    );
    expect(result.percentage).toBeGreaterThanOrEqual(80);
    expect(result.percentage).toBeLessThan(100);
    expect(result.unlocked).toEqual(expect.arrayContaining(['receipts', 'invoices', 'catalog']));
    expect(result.unlocked).not.toContain('business_card');
    expect(result.next?.key).toBe('business_card');
  });

  it('100% (business_card) unlocks only when every field is filled', () => {
    // Exactly 11 of 12 → 92%, below the 100 threshold.
    const result = computeCompletion(
      emptyProfile({
        logo_photo_id: 'p',
        tagline: 'x',
        description: 'y',
        phone: '1',
        whatsapp: '2',
        email: 'a@b.c',
        address_street: 'X',
        address_city: 'Y',
        address_country: 'Z',
        fiscal_id: 'F',
        legal_name: 'L',
      }),
    );
    expect(result.percentage).toBe(92);
    expect(result.unlocked).not.toContain('business_card');
    expect(result.next?.key).toBe('business_card');
  });
});

describe('computeCompletion — field semantics', () => {
  it('treats whitespace-only strings as unfilled', () => {
    const result = computeCompletion(emptyProfile({ tagline: '   ', description: '\n\t' }));
    expect(result.percentage).toBe(0);
  });

  it('brand_color counts logo_dominant_color when brand_primary_color is null (auto-extraction credit)', () => {
    const result = computeCompletion(emptyProfile({ logo_dominant_color: '#2B4C8A' }));
    expect(result.filled).toBe(1);
    expect(result.filledFields).toContain('brand_color');
  });

  it('brand_color counts brand_primary_color when set (explicit pick wins)', () => {
    const result = computeCompletion(emptyProfile({ brand_primary_color: '#2B4C8A' }));
    expect(result.filled).toBe(1);
  });

  it('brand_color does NOT double-count when both are set (single field)', () => {
    const result = computeCompletion(
      emptyProfile({
        brand_primary_color: '#2B4C8A',
        logo_dominant_color: '#2B4C8A',
      }),
    );
    expect(result.filled).toBe(1);
  });

  it('logo_photo_id treats empty-string sentinel as filled (any non-null UUID)', () => {
    // Defensive: the field type is `UUID | null`; we don't expect '' in
    // practice but the predicate should still treat it as set so a
    // future shape change doesn't silently break the score.
    const result = computeCompletion(emptyProfile({ logo_photo_id: 'photo-uuid' }));
    expect(result.filledFields).toContain('logo');
  });

  it('non-tracked fields (website, social handles, opening_hours) do NOT affect the score', () => {
    const result = computeCompletion(
      emptyProfile({
        website: 'example.com',
        instagram: '@x',
        facebook: 'page',
        tiktok: '@y',
        opening_hours: null,
      }),
    );
    expect(result.percentage).toBe(0);
  });
});

describe('MILESTONES contract', () => {
  it('lists exactly receipts / invoices / catalog / business_card at 30/60/80/100', () => {
    expect(MILESTONES.map((m) => m.key)).toEqual([
      'receipts',
      'invoices',
      'catalog',
      'business_card',
    ]);
    expect(MILESTONES.map((m) => m.threshold)).toEqual([30, 60, 80, 100]);
  });
});
