import { type Locale } from '../types';

// Western → Eastern Arabic digit table. SPEC §6 / ADR-006: AR locale renders
// all user-facing numerics in Eastern Arabic digits.
const EASTERN: readonly string[] = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toEasternDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => EASTERN[Number(d)]!);
}

// Locale used as the base for Intl formatting. We deliberately use fr-TN as
// the base for both 'fr' AND 'ar' so grouping/decimal separators are stable
// (space grouping, comma decimal) regardless of ICU version, and then
// substitute digit glyphs for 'ar'. Predictable across Node 20+ environments.
function intlBaseLocale(locale: Locale): string {
  if (locale === 'en') return 'en-US';
  return 'fr-TN';
}

export function formatNumber(n: number, locale: Locale): string {
  const base = new Intl.NumberFormat(intlBaseLocale(locale)).format(n);
  return locale === 'ar' ? toEasternDigits(base) : base;
}
