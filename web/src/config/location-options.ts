import { type Locale } from '../types';

// v0.6 ADR-028 — predefined location-label options offered in onboarding's
// "Where do you keep stock?" step and Settings → Stock locations.
//
// Per the design brief, the same option list applies to BOTH verticals
// (Fashion + Shop). Vertical-specific *migration* defaults from
// migrate-v8-to-v9 stay untouched — those seed the field the first
// time a profile is created or migrated, and the merchant chooses or
// types over them via the picker.
//
// The strings here are also the *stored values*. When a merchant
// switches locale later, `useLocationLabels()` returns the literal
// stored string (per ADR-022: labels are merchant-customisable, NOT
// auto-translated).

export interface LocationOptions {
  floor: readonly string[];
  back: readonly string[];
}

export const LOCATION_OPTIONS: Record<Locale, LocationOptions> = {
  en: {
    floor: ['Shop floor', 'Display', 'Front'],
    back: ['Stockroom', 'Storage', 'Back'],
  },
  fr: {
    floor: ['Magasin', 'Boutique', 'Comptoir'],
    back: ['Réserve', 'Stock', 'Arrière'],
  },
  ar: {
    floor: ['المحل', 'الواجهة', 'العرض'],
    back: ['المخزن', 'التخزين', 'المستودع'],
  },
};

// The pre-selected default per locale (the first entry in each list).
// Onboarding sets these as the initial state when the merchant lands
// on the locations step; Settings reads from the merchant's stored
// value first, falling back to these only when nothing is set.
export const LOCATION_PICKER_DEFAULTS: Record<Locale, { floor: string; back: string }> = {
  en: { floor: 'Shop floor', back: 'Stockroom' },
  fr: { floor: 'Magasin', back: 'Réserve' },
  ar: { floor: 'المحل', back: 'المخزن' },
};
