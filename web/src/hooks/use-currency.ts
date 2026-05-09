import { type CurrencyCode } from '../types';
import { DEFAULT_CURRENCY } from '../repos/profile';
import { useProfile } from './use-profile';

// Returns the user's chosen currency code, falling back to DEFAULT_CURRENCY
// while the profile is still loading or absent. Callers use this to drive
// formatCurrency / parseCurrency.
export function useCurrency(): CurrencyCode {
  const profile = useProfile();
  return profile?.currency ?? DEFAULT_CURRENCY;
}
