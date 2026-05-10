import { type Location } from '../types';
import { defaultLocationLabels } from '../db/migrate-v8-to-v9';
import { useLocale } from './use-locale';
import { useProfile } from './use-profile';

// v0.5.2 ADR-022: every UI surface that displays a stock location reads
// labels from this hook. The internal Movement.location enum stays
// 'floor' / 'back' for storage and indexing — labels are a pure display
// alias. Defaults come from defaultLocationLabels() when a profile field
// is unset (handles the brief window before v8→v9 migration completes,
// or a freshly-created profile that hasn't yet been through the
// onboarding locations step).

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
    floor:
      profile?.location_floor_label && profile.location_floor_label.trim() !== ''
        ? profile.location_floor_label
        : defaults.floor,
    back:
      profile?.location_back_label && profile.location_back_label.trim() !== ''
        ? profile.location_back_label
        : defaults.back,
  };
}

// Convenience: maps a Location enum value to its merchant-facing label.
// Useful for table cells and dropdowns that already iterate
// ['floor', 'back'].
export function labelForLocation(loc: Location, labels: LocationLabels): string {
  return loc === 'floor' ? labels.floor : labels.back;
}
