import { type CurrencyCode } from '../types';

// Currency helpers built on top of `Intl`. Since ICU's set of supported
// currencies is huge and version-dependent, we don't ship a hand-rolled list
// of "valid" codes — we trust Intl to know.

// Cache the per-currency minor-unit exponent so we don't re-resolve the
// formatter on every render. ICU returns the same answer for a given code
// across the lifetime of the process.
const minorDigitsCache = new Map<string, number>();

// Returns the number of fractional digits this currency uses in its minor
// unit (TND=3, USD/EUR=2, JPY/KRW=0). Uses Intl.NumberFormat — the same
// source `formatCurrency` consults — so display and storage stay aligned.
export function getMinorUnitDigits(currency: CurrencyCode): number {
  const cached = minorDigitsCache.get(currency);
  if (cached !== undefined) return cached;
  // resolvedOptions.maximumFractionDigits for a `style: 'currency'`
  // formatter reflects the currency's CLDR-defined minor unit precision.
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  minorDigitsCache.set(currency, digits);
  return digits;
}

// Number of minor units per major unit. 1 USD = 100 cents, 1 TND = 1000
// millimes, 1 JPY = 1 yen.
export function getMinorUnitFactor(currency: CurrencyCode): number {
  return 10 ** getMinorUnitDigits(currency);
}

// All currencies the runtime knows about, suitable for a picker. We use
// `Intl.supportedValuesOf('currency')` when available (modern browsers,
// Node ≥ 18) and fall back to a small pragmatic set otherwise so the
// picker still works in older runtimes.
const FALLBACK_CURRENCIES: readonly CurrencyCode[] = [
  'TND',
  'USD',
  'EUR',
  'GBP',
  'MAD',
  'DZD',
  'EGP',
  'SAR',
  'AED',
  'KWD',
  'BHD',
  'QAR',
  'OMR',
  'JOD',
  'LBP',
  'LYD',
  'JPY',
  'CNY',
  'CHF',
  'CAD',
];

export function listSupportedCurrencies(): readonly CurrencyCode[] {
  const intlAny = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  if (typeof intlAny.supportedValuesOf === 'function') {
    return intlAny.supportedValuesOf('currency');
  }
  return FALLBACK_CURRENCIES;
}

// Priority currencies shown at the top of the picker, in order.
// These represent the most common currencies for Inventar's target
// markets — North Africa, Gulf, and major international currencies.
export const PRIORITY_CURRENCIES: readonly CurrencyCode[] = [
  'TND',
  'EUR',
  'USD',
  'MAD',
  'DZD',
  'GBP',
  'SAR',
  'AED',
  'EGP',
];

// Module-level cache so we only construct Intl.DisplayNames once.
let _dn: Intl.DisplayNames | null = null;

// Returns the English display name of a currency code.
// Falls back to the code itself when the runtime doesn't know the
// currency (rare — Intl covers every ISO 4217 code in modern runtimes).
export function getCurrencyName(code: CurrencyCode): string {
  try {
    if (!_dn) _dn = new Intl.DisplayNames(['en'], { type: 'currency' });
    return _dn.of(code) ?? code;
  } catch {
    return code;
  }
}
