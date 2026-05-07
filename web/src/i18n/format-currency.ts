import { type Locale } from '../types';

// ADR-005: money is stored as integer millimes (1 TND = 1000 millimes). The
// display layer is the only place that crosses back into decimal TND, and it
// always shows 3 fraction digits because that is the actual unit precision.
const MILLIMES_PER_TND = 1000;
const TND_FRACTION_DIGITS = 3;

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

// Renders an integer millimes amount as a localised currency string (TND).
// Per SPEC §5: Intl.NumberFormat(..., {style:'currency', currency:'TND'}).
export function formatCurrency(millimes: number, locale: Locale): string {
  const tnd = millimes / MILLIMES_PER_TND;
  const formatted = new Intl.NumberFormat(intlBaseLocale(locale), {
    style: 'currency',
    currency: 'TND',
    minimumFractionDigits: TND_FRACTION_DIGITS,
    maximumFractionDigits: TND_FRACTION_DIGITS,
  }).format(tnd);
  return locale === 'ar' ? toEasternDigits(formatted) : formatted;
}
