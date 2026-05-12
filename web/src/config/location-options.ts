import { type Locale } from '../types';

// v0.6 ADR-029 / v0.6.3 amendment — predefined location-label options
// offered in onboarding's "Where do you keep stock?" step and
// Settings → Stock locations.
//
// Per the design brief the same option list applies to BOTH verticals
// (Fashion + Shop). Vertical-specific *migration* defaults from
// migrate-v8-to-v9 stay untouched — those seed the field the first
// time a profile is created or migrated, and the merchant chooses or
// types over them via the picker.
//
// v0.6.3 storage-shape change. Until v0.6.2 the picker stored the
// literal display string ("Shop floor" / "المحل" / …). That made the
// stored value locale-specific: a profile written in AR rendered as
// raw "الواجهة" when later viewed in EN, and SelectWithCustom flipped
// into custom-input mode because the stored string wasn't in the EN
// option list. Storage now uses zone-aware KEYS
// (`shop_floor` / `display` / `front` for the front zone, etc.) and
// useLocationLabels() resolves them to the current locale's display
// at render time. Custom-typed values are persisted with a `custom:`
// prefix so the read-side can distinguish them from keys.

export const CUSTOM_PREFIX = 'custom:';

export type FrontKey = 'shop_floor' | 'display' | 'front';
export type BackKey = 'stockroom' | 'storage' | 'back';

// Order-preserving — Object.values() walks the keys in insertion
// order (ES2015+), which is what the dropdown picker shows. Keep the
// keys in the desired UI order: the FIRST entry in each zone is the
// pre-selected default for new merchants (matches v0.6 ADR-029).
export const FRONT_OPTIONS_BY_KEY: Record<Locale, Record<FrontKey, string>> = {
  en: { shop_floor: 'Shop floor', display: 'Display', front: 'Front' },
  fr: { shop_floor: 'Magasin', display: 'Boutique', front: 'Comptoir' },
  ar: { shop_floor: 'المحل', display: 'الواجهة', front: 'العرض' },
};

export const BACK_OPTIONS_BY_KEY: Record<Locale, Record<BackKey, string>> = {
  en: { stockroom: 'Stockroom', storage: 'Storage', back: 'Back' },
  fr: { stockroom: 'Réserve', storage: 'Stock', back: 'Arrière' },
  ar: { stockroom: 'المخزن', storage: 'التخزين', back: 'المستودع' },
};

export const FRONT_KEYS: readonly FrontKey[] = ['shop_floor', 'display', 'front'];
export const BACK_KEYS: readonly BackKey[] = ['stockroom', 'storage', 'back'];

// Existing structure preserved for the SelectWithCustom call sites —
// each consumer wants a flat string[] keyed by locale. Derive once at
// module load from the by-key tables so the order matches the picker.
export interface LocationOptions {
  floor: readonly string[];
  back: readonly string[];
}

function deriveOptions(): Record<Locale, LocationOptions> {
  const out: Record<Locale, LocationOptions> = {
    en: { floor: [], back: [] },
    fr: { floor: [], back: [] },
    ar: { floor: [], back: [] },
  };
  for (const locale of ['en', 'fr', 'ar'] as const) {
    out[locale] = {
      floor: FRONT_KEYS.map((k) => FRONT_OPTIONS_BY_KEY[locale][k]),
      back: BACK_KEYS.map((k) => BACK_OPTIONS_BY_KEY[locale][k]),
    };
  }
  return out;
}

export const LOCATION_OPTIONS: Record<Locale, LocationOptions> = deriveOptions();

// First option per zone — onboarding's initial state + the
// SelectWithCustom empty-fallback target.
export const LOCATION_PICKER_DEFAULTS: Record<Locale, { floor: string; back: string }> = {
  en: { floor: FRONT_OPTIONS_BY_KEY.en.shop_floor, back: BACK_OPTIONS_BY_KEY.en.stockroom },
  fr: { floor: FRONT_OPTIONS_BY_KEY.fr.shop_floor, back: BACK_OPTIONS_BY_KEY.fr.stockroom },
  ar: { floor: FRONT_OPTIONS_BY_KEY.ar.shop_floor, back: BACK_OPTIONS_BY_KEY.ar.stockroom },
};

// ── Key resolution helpers ─────────────────────────────────────────

export function isFrontKey(s: string): s is FrontKey {
  return (FRONT_KEYS as readonly string[]).includes(s);
}

export function isBackKey(s: string): s is BackKey {
  return (BACK_KEYS as readonly string[]).includes(s);
}

export function isCustomValue(s: string): boolean {
  return s.startsWith(CUSTOM_PREFIX);
}

export function stripCustomPrefix(s: string): string {
  return isCustomValue(s) ? s.slice(CUSTOM_PREFIX.length) : s;
}

export function displayForFrontKey(key: FrontKey, locale: Locale): string {
  return FRONT_OPTIONS_BY_KEY[locale][key];
}

export function displayForBackKey(key: BackKey, locale: Locale): string {
  return BACK_OPTIONS_BY_KEY[locale][key];
}

// Reverse-lookup: scan every (locale, key) display string for the
// given zone and return the matching key. Zone-aware on purpose —
// a merchant who types "Back" as a FRONT-zone custom value should
// be preserved as a custom value, not coerced into the back-zone
// `back` key.
export function frontKeyForDisplay(display: string): FrontKey | null {
  const trimmed = display.trim();
  if (trimmed === '') return null;
  for (const locale of ['en', 'fr', 'ar'] as const) {
    for (const key of FRONT_KEYS) {
      if (FRONT_OPTIONS_BY_KEY[locale][key] === trimmed) return key;
    }
  }
  return null;
}

export function backKeyForDisplay(display: string): BackKey | null {
  const trimmed = display.trim();
  if (trimmed === '') return null;
  for (const locale of ['en', 'fr', 'ar'] as const) {
    for (const key of BACK_KEYS) {
      if (BACK_OPTIONS_BY_KEY[locale][key] === trimmed) return key;
    }
  }
  return null;
}

// ── Normalisation for write + migration ────────────────────────────

// Converts a UI display string (or a typed-custom string) into the
// canonical stored shape: either a known key, or `custom:${raw}`.
// Used at write time by Settings + Onboarding, and once by the
// Dexie v13 .upgrade() to convert legacy display-string rows.
export function normaliseFrontLabel(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return trimmed;
  // Already a key — keep it.
  if (isFrontKey(trimmed)) return trimmed;
  // Already a custom: value — keep the prefix.
  if (isCustomValue(trimmed)) return trimmed;
  // A display string that matches a known key.
  const key = frontKeyForDisplay(trimmed);
  if (key) return key;
  // Genuine custom — prefix it.
  return `${CUSTOM_PREFIX}${trimmed}`;
}

export function normaliseBackLabel(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '') return trimmed;
  if (isBackKey(trimmed)) return trimmed;
  if (isCustomValue(trimmed)) return trimmed;
  const key = backKeyForDisplay(trimmed);
  if (key) return key;
  return `${CUSTOM_PREFIX}${trimmed}`;
}
