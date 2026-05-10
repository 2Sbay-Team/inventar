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

// v0.5.1: known short symbols / abbreviations a stripped-down ICU build
// might still emit for these currencies. Used by ensureCurrencyVisible
// to decide whether the formatted string already shows a marker the
// merchant can read.
const KNOWN_SYMBOLS: Record<string, readonly string[]> = {
  TND: ['DT', 'د.ت', 'TND'],
  USD: ['$', 'US$', 'USD'],
  EUR: ['€', 'EUR'],
  GBP: ['£', 'GBP'],
  JPY: ['¥', 'JPY', 'JP¥'],
  CNY: ['¥', 'CN¥', 'CNY'],
  MAD: ['MAD', 'DH', 'د.م.'],
  DZD: ['DZD', 'DA', 'د.ج'],
  EGP: ['EGP', 'E£', 'ج.م'],
  SAR: ['SAR', 'SR', 'ر.س'],
  AED: ['AED', 'د.إ'],
  KWD: ['KWD', 'د.ك'],
  BHD: ['BHD', 'د.ب'],
  QAR: ['QAR', 'ر.ق'],
  OMR: ['OMR', 'ر.ع'],
  JOD: ['JOD', 'د.أ'],
  LBP: ['LBP', 'ل.ل'],
  LYD: ['LYD', 'د.ل'],
  CHF: ['CHF'],
  CAD: ['CAD', 'CA$', '$'],
};

function ensureCurrencyVisible(formatted: string, currency: CurrencyCode): string {
  // The full ISO code being present is the strongest guarantee. If it's
  // there, we trust the formatter.
  if (formatted.includes(currency)) return formatted;
  // Otherwise check the per-currency known-symbols list. If any of them
  // appear, the merchant has a visible marker.
  const symbols = KNOWN_SYMBOLS[currency] ?? [];
  for (const s of symbols) {
    if (s !== '' && formatted.includes(s)) return formatted;
  }
  // Belt-and-suspenders: append the ISO code with a regular space.
  // This fires only on stripped-down ICU builds that drop the
  // currency marker entirely (some Android WebViews on older
  // Honor / Huawei devices have done this for less common pairs).
  return `${formatted} ${currency}`;
}

// Renders an integer minor-unit amount as a localised currency string. The
// fraction digit count comes from CLDR (TND=3, USD=2, JPY=0). Falls back
// to a plain decimal + suffixed currency code if Intl rejects the
// locale/currency combination — the merchant always sees their amount,
// even on ancient / stripped ICU builds.
export function formatCurrency(minor: number, locale: Locale, currency: CurrencyCode): string {
  const digits = getMinorUnitDigits(currency);
  const major = minor / getMinorUnitFactor(currency);
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(intlBaseLocale(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    // Intl threw — most likely a currency code not in the runtime's
    // CLDR table, or a locale that isn't recognised. Fall back to a
    // plain decimal in en-US (the lowest common denominator) and let
    // ensureCurrencyVisible suffix the ISO code.
    try {
      formatted = new Intl.NumberFormat('en-US', {
        style: 'decimal',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(major);
    } catch {
      // Even Intl.NumberFormat with style:'decimal' failed (extreme
      // edge case — broken Intl). Last-resort: native Number toFixed.
      formatted = major.toFixed(digits);
    }
  }
  formatted = ensureCurrencyVisible(formatted, currency);
  return locale === 'ar' ? toEasternDigits(formatted) : formatted;
}
