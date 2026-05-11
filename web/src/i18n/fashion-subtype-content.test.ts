import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

// v0.5.6 polish — content assertions on the fashion-subtypes copy that
// the v0.5.6 brief calls out specifically. Pinned in tests so a future
// translation refactor can't silently regress them.

describe('fashion_subtypes.shoes_label clarity (Issue 1)', () => {
  it('EN spells out "Adult shoes (men and women)"', () => {
    expect(en.fashion_subtypes.shoes_label).toBe('Adult shoes (men and women)');
  });

  it('FR uses "Chaussures adultes (hommes et femmes)"', () => {
    expect(fr.fashion_subtypes.shoes_label).toBe('Chaussures adultes (hommes et femmes)');
  });

  it('AR uses "أحذية للكبار (رجال ونساء)"', () => {
    expect(ar.fashion_subtypes.shoes_label).toBe('أحذية للكبار (رجال ونساء)');
  });
});

describe('onboarding.fashion_subtypes_subtitle does not leak internal IDs (Issue 2)', () => {
  // The merchant-facing description must use the user-facing labels
  // (Men's clothing, Women's clothing, Kids' clothing) rather than the
  // internal sub-type keys (clothing_men, clothing_women, clothing_kids).
  const internalIds = ['clothing_men', 'clothing_women', 'clothing_kids', 'shoes_kids'];

  it.each([
    ['en', en.onboarding.fashion_subtypes_subtitle],
    ['fr', fr.onboarding.fashion_subtypes_subtitle],
    ['ar', ar.onboarding.fashion_subtypes_subtitle],
  ])('%s subtitle contains no internal sub-type IDs', (_locale, subtitle) => {
    for (const id of internalIds) {
      expect(subtitle).not.toContain(id);
    }
  });

  it('EN subtitle mentions both clothing variants and Kids', () => {
    const s = en.onboarding.fashion_subtypes_subtitle;
    expect(s).toContain("Men's clothing");
    expect(s).toContain("Women's clothing");
    expect(s).toContain("Kids' clothing");
  });

  it('FR subtitle mentions both clothing variants and Kids', () => {
    const s = fr.onboarding.fashion_subtypes_subtitle;
    expect(s).toContain('Vêtements hommes');
    expect(s).toContain('Vêtements femmes');
    expect(s).toContain('Vêtements enfants');
  });

  it('AR subtitle mentions both clothing variants and Kids', () => {
    const s = ar.onboarding.fashion_subtypes_subtitle;
    expect(s).toContain('ملابس رجالية');
    expect(s).toContain('ملابس نسائية');
    expect(s).toContain('ملابس الأطفال');
  });
});
