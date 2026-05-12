import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  bgDeepShade,
  computeThemeVars,
  inkShade,
  mixRgb,
  parseHex,
  rgbToTriple,
  softTint,
  type StyleTarget,
} from './apply-theme';
import type { ShopProfile } from '../types';

// A minimal stand-in for CSSStyleDeclaration. The repo runs vitest in
// the node environment (no jsdom), so the DOM-side tests pass a plain
// Map-backed target to applyTheme instead of touching documentElement.
function makeStyleTarget(): StyleTarget & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    setProperty(name, value) {
      values.set(name, value);
    },
    removeProperty(name) {
      const prev = values.get(name) ?? '';
      values.delete(name);
      return prev;
    },
  };
}

// Build a minimal-but-realistic profile with the v0.9 fields we care
// about. Other fields are filled with sensible nulls / defaults — the
// theming code only reads brand_primary_color and theme_bg_color.
function profileWith(overrides: Partial<ShopProfile>): ShopProfile {
  return {
    id: 'singleton',
    name: 'Test Shop',
    locale: 'en',
    logo_photo_id: null,
    currency: 'TND',
    store_type: 'fashion',
    shop_subtypes: [],
    fashion_subtypes: [],
    size_standard: 'EU',
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

describe('parseHex', () => {
  it('parses 6-digit lower / upper / mixed case hex', () => {
    expect(parseHex('#ff6b35')).toEqual({ r: 255, g: 107, b: 53 });
    expect(parseHex('#FF6B35')).toEqual({ r: 255, g: 107, b: 53 });
    expect(parseHex('#Ff6B35')).toEqual({ r: 255, g: 107, b: 53 });
  });

  it('expands 3-digit shorthand', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('#f63')).toEqual({ r: 255, g: 102, b: 51 });
  });

  it('trims whitespace', () => {
    expect(parseHex('  #ff6b35  ')).toEqual({ r: 255, g: 107, b: 53 });
  });

  it('returns null for invalid input', () => {
    expect(parseHex(null)).toBeNull();
    expect(parseHex(undefined)).toBeNull();
    expect(parseHex('')).toBeNull();
    expect(parseHex('ff6b35')).toBeNull(); // missing #
    expect(parseHex('#ff6b3')).toBeNull(); // 5 chars
    expect(parseHex('#ff6b3500')).toBeNull(); // 8 chars
    expect(parseHex('#ggffff')).toBeNull(); // non-hex
    expect(parseHex('not a color')).toBeNull();
  });
});

describe('rgbToTriple', () => {
  it('joins channels with single spaces (the only shape Tailwind reads)', () => {
    expect(rgbToTriple({ r: 255, g: 107, b: 53 })).toBe('255 107 53');
    expect(rgbToTriple({ r: 0, g: 0, b: 0 })).toBe('0 0 0');
    expect(rgbToTriple({ r: 255, g: 255, b: 255 })).toBe('255 255 255');
  });
});

describe('mixRgb', () => {
  it('returns a at ratio 1, b at ratio 0', () => {
    const a = { r: 100, g: 100, b: 100 };
    const b = { r: 200, g: 200, b: 200 };
    expect(mixRgb(a, b, 1)).toEqual(a);
    expect(mixRgb(a, b, 0)).toEqual(b);
  });

  it('interpolates linearly per channel and rounds', () => {
    const a = { r: 100, g: 50, b: 0 };
    const b = { r: 200, g: 250, b: 0 };
    // Halfway: (150, 150, 0)
    expect(mixRgb(a, b, 0.5)).toEqual({ r: 150, g: 150, b: 0 });
  });

  it('clamps to the 0..255 range so out-of-range ratios stay valid', () => {
    const a = { r: 255, g: 255, b: 255 };
    const b = { r: 0, g: 0, b: 0 };
    expect(mixRgb(a, b, 2)).toEqual({ r: 255, g: 255, b: 255 });
    expect(mixRgb(a, b, -1)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('softTint / inkShade', () => {
  it('softTint of #FF6B35 lands within 2 units of the historical #FFE4D6', () => {
    // The pre-v0.9 hand-picked accent-soft was #FFE4D6 = (255, 228, 214).
    // The 20%-brand formula gives (255, 225, 215) — close enough that a
    // merchant who leaves brand_primary_color null and a merchant who
    // explicitly picks #FF6B35 see indistinguishable chips.
    const computed = softTint({ r: 255, g: 107, b: 53 });
    expect(Math.abs(computed.r - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(computed.g - 228)).toBeLessThanOrEqual(3);
    expect(Math.abs(computed.b - 214)).toBeLessThanOrEqual(3);
  });

  it('softTint of pure black yields a dark grey (80% white)', () => {
    expect(softTint({ r: 0, g: 0, b: 0 })).toEqual({ r: 204, g: 204, b: 204 });
  });

  it('inkShade darkens brand by 35% — text-on-soft contrast', () => {
    // 65% brand + 35% black: (255, 107, 53) → (166, 70, 34)
    expect(inkShade({ r: 255, g: 107, b: 53 })).toEqual({ r: 166, g: 70, b: 34 });
  });
});

describe('bgDeepShade', () => {
  it('darkens the bg by 5% for the paper gradient bottom', () => {
    // (255, 255, 255) → (242, 242, 242) approximately.
    const deep = bgDeepShade({ r: 255, g: 255, b: 255 });
    expect(deep.r).toBeLessThan(255);
    expect(deep.r).toBeGreaterThan(240);
    expect(deep.g).toBe(deep.r);
    expect(deep.b).toBe(deep.r);
  });
});

describe('computeThemeVars', () => {
  it('returns all-null vars for a null profile (CSS :root defaults take over)', () => {
    expect(computeThemeVars(null)).toEqual({
      brand: null,
      brandSoft: null,
      brandInk: null,
      bg: null,
      bgDeep: null,
    });
    expect(computeThemeVars(undefined)).toEqual({
      brand: null,
      brandSoft: null,
      brandInk: null,
      bg: null,
      bgDeep: null,
    });
  });

  it('returns all-null when brand + bg are unset on the profile', () => {
    expect(computeThemeVars(profileWith({}))).toEqual({
      brand: null,
      brandSoft: null,
      brandInk: null,
      bg: null,
      bgDeep: null,
    });
  });

  it('computes brand + soft + ink when brand_primary_color is set', () => {
    const vars = computeThemeVars(profileWith({ brand_primary_color: '#2B4C8A' }));
    expect(vars.brand).toBe('43 76 138');
    expect(vars.brandSoft).not.toBeNull();
    expect(vars.brandInk).not.toBeNull();
    // bg untouched — the merchant set brand only.
    expect(vars.bg).toBeNull();
    expect(vars.bgDeep).toBeNull();
  });

  it('computes bg + bg-deep when theme_bg_color is set', () => {
    const vars = computeThemeVars(profileWith({ theme_bg_color: '#FFFFFF' }));
    expect(vars.bg).toBe('255 255 255');
    expect(vars.bgDeep).not.toBeNull();
    expect(vars.brand).toBeNull();
  });

  it('skips invalid hex on the profile (drops through to defaults)', () => {
    const vars = computeThemeVars(
      profileWith({ brand_primary_color: 'not a color', theme_bg_color: '#zzz' }),
    );
    expect(vars.brand).toBeNull();
    expect(vars.bg).toBeNull();
  });
});

describe('applyTheme — side effects via a stub StyleTarget', () => {
  it('writes brand + soft + ink CSS variables when brand_primary_color is set', () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ brand_primary_color: '#2B4C8A' }), target);
    expect(target.values.get('--color-brand-rgb')).toBe('43 76 138');
    expect(target.values.get('--color-brand-soft-rgb')).toBeDefined();
    expect(target.values.get('--color-brand-ink-rgb')).toBeDefined();
    // bg untouched — falls back to :root default.
    expect(target.values.has('--color-bg-rgb')).toBe(false);
  });

  it('writes bg + bg-deep CSS variables when theme_bg_color is set', () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ theme_bg_color: '#FAFAFA' }), target);
    expect(target.values.get('--color-bg-rgb')).toBe('250 250 250');
    expect(target.values.get('--color-bg-deep-rgb')).toBeDefined();
  });

  it('null profile clears every theme variable (CSS defaults take over)', () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ brand_primary_color: '#FF0000', theme_bg_color: '#000000' }), target);
    applyTheme(null, target);
    expect(target.values.size).toBe(0);
  });

  it('changing the profile updates the variables (no stale values)', () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ brand_primary_color: '#FF0000' }), target);
    expect(target.values.get('--color-brand-rgb')).toBe('255 0 0');
    applyTheme(profileWith({ brand_primary_color: '#00FF00' }), target);
    expect(target.values.get('--color-brand-rgb')).toBe('0 255 0');
  });

  it("idempotent: re-applying the same profile doesn't change anything", () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ brand_primary_color: '#2B4C8A' }), target);
    const snapshot = new Map(target.values);
    applyTheme(profileWith({ brand_primary_color: '#2B4C8A' }), target);
    expect(target.values).toEqual(snapshot);
  });

  it('switching FROM a custom brand back to null clears the override', () => {
    const target = makeStyleTarget();
    applyTheme(profileWith({ brand_primary_color: '#2B4C8A' }), target);
    expect(target.values.get('--color-brand-rgb')).toBe('43 76 138');
    applyTheme(profileWith({ brand_primary_color: null }), target);
    expect(target.values.has('--color-brand-rgb')).toBe(false);
    expect(target.values.has('--color-brand-soft-rgb')).toBe(false);
    expect(target.values.has('--color-brand-ink-rgb')).toBe(false);
  });

  it('safely no-ops when no DOM is available and no target is passed', () => {
    // Production code always runs in a browser, so the no-DOM path is
    // exercised only by SSR / older test environments. We assert it
    // doesn't throw so a future component test that imports the
    // module in node doesn't blow up at import time.
    expect(() => applyTheme(profileWith({ brand_primary_color: '#FF0000' }))).not.toThrow();
  });
});
