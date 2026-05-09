import { type CurrencyCode, type Locale } from '../types';
import { getMinorUnitDigits, getMinorUnitFactor } from './currency';

// ADR-005 (revised): money is stored as integer minor units of the user's
// chosen currency (TND=millimes, USD=cents, JPY=yen). The display layer is
// the only place that crosses back into the major unit, and the number of
// fraction digits is derived from the currency code (CLDR via Intl).

const EASTERN: readonly string[] = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toEasternDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => EASTERN[Number(d)]!);
}

function intlBaseLocale(locale: Locale): string {
  // Use fr-TN as the base for both fr and ar so grouping/decimal characters
  // and the currency placement are deterministic across ICU builds. AR then
  // gets digit-glyph substitution. en uses en-US as a sensible default.
  if (locale === 'en') return 'en-US';
  return 'fr-TN';
}

// Renders an integer minor-unit amount as a localised currency string. The
// fraction digit count comes from CLDR (TND=3, USD=2, JPY=0).
export function formatCurrency(minor: number, locale: Locale, currency: CurrencyCode): string {
  const digits = getMinorUnitDigits(currency);
  const major = minor / getMinorUnitFactor(currency);
  const formatted = new Intl.NumberFormat(intlBaseLocale(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
  return locale === 'ar' ? toEasternDigits(formatted) : formatted;
}
