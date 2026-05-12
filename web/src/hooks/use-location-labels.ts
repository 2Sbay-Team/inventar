import { type Location } from '../types';
import { defaultLocationLabels } from '../db/migrate-v8-to-v9';
import {
  BACK_OPTIONS_BY_KEY,
  CUSTOM_PREFIX,
  FRONT_OPTIONS_BY_KEY,
  backKeyForDisplay,
  frontKeyForDisplay,
  isBackKey,
  isCustomValue,
  isFrontKey,
} from '../config/location-options';
import { useLocale } from './use-locale';
import { useProfile } from './use-profile';

// v0.5.2 ADR-022 / v0.6.3 amendment — every UI surface that displays a
// stock location reads labels from this hook. The internal
// Movement.location enum stays 'floor' / 'back' for storage and
// indexing — labels are a pure display alias.
//
// Resolution order for each stored value:
//
//   1. Empty / null → fall back to the (vertical, locale) default
//      from defaultLocationLabels(). Handles the brief window before
//      the v8→v9 migration runs or a freshly-created profile that
//      hasn't yet gone through onboarding's locations step.
//   2. Matches a known FrontKey / BackKey (e.g. "shop_floor") →
//      translate to the CURRENT UI locale's display string via the
//      FRONT_OPTIONS_BY_KEY / BACK_OPTIONS_BY_KEY tables.
//   3. Starts with `custom:` → strip the prefix and return the
//      verbatim merchant-typed value.
//   4. Anything else → render verbatim (legacy fallback for v6/v7
//      profiles that pre-date the v13 migration; safer than throwing).

export interface LocationLabels {
  floor: string;
  back: string;
}

export function useLocationLabels(): LocationLabels {
  const profile = useProfile();
  const { locale } = useLocale();
  // Vertical for label fallback: 'fashion' for fashion / shoes / clothes,
  // 'shop' for everything else. Mirrors the same logic in
  // migrate-v8-to-v9.
  const verticalForLabels: 'fashion' | 'shop' = profile?.store_type === 'shop' ? 'shop' : 'fashion';
  const defaults = defaultLocationLabels(verticalForLabels, locale);
  return {
    floor: resolveFrontLabel(profile?.location_floor_label, locale, defaults.floor),
    back: resolveBackLabel(profile?.location_back_label, locale, defaults.back),
  };
}

function resolveFrontLabel(
  stored: string | undefined | null,
  locale: 'en' | 'fr' | 'ar',
  fallback: string,
): string {
  if (!stored || stored.trim() === '') return fallback;
  if (isFrontKey(stored)) return FRONT_OPTIONS_BY_KEY[locale][stored];
  if (isCustomValue(stored)) return stored.slice(CUSTOM_PREFIX.length);
  // Legacy plain display string — covers v6 / v7 profiles that
  // skipped the v13 migration, backup imports, and seeded test
  // rows that bypass the Dexie upgrade path. Try a reverse lookup
  // so the resolver can still render in the current locale; if
  // the string isn't a known display, fall through to verbatim.
  const reverseKey = frontKeyForDisplay(stored);
  if (reverseKey) return FRONT_OPTIONS_BY_KEY[locale][reverseKey];
  return stored;
}

function resolveBackLabel(
  stored: string | undefined | null,
  locale: 'en' | 'fr' | 'ar',
  fallback: string,
): string {
  if (!stored || stored.trim() === '') return fallback;
  if (isBackKey(stored)) return BACK_OPTIONS_BY_KEY[locale][stored];
  if (isCustomValue(stored)) return stored.slice(CUSTOM_PREFIX.length);
  const reverseKey = backKeyForDisplay(stored);
  if (reverseKey) return BACK_OPTIONS_BY_KEY[locale][reverseKey];
  return stored;
}

// Convenience: maps a Location enum value to its merchant-facing label.
// Useful for table cells and dropdowns that already iterate
// ['floor', 'back'].
export function labelForLocation(loc: Location, labels: LocationLabels): string {
  return loc === 'floor' ? labels.floor : labels.back;
}
