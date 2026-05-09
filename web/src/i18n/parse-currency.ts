import { type CurrencyCode, type Locale } from '../types';
import { getMinorUnitDigits } from './currency';
import { normaliseDigits } from '../query/normalise-digits';

// ADR-005 (revised): parse user-typed currency input back to integer minor
// units of the supplied currency. Strict per-locale parsing — the rules
// mirror what `formatCurrency` outputs, so round-tripping
// `parse(format(x), locale, ccy) === x` holds for the (locale, currency)
// pair the value was formatted in.
//   - en: '.' is the decimal mark, ',' is thousands grouping
//   - fr / ar: ',' is the decimal mark, '.' is thousands grouping
// NBSP grouping (U+00A0, U+202F) is tolerated in all locales.
//
// String arithmetic only — no float multiplication. Keeps the round-trip
// exact at minor-unit precision.

export function parseCurrency(
  input: string,
  locale: Locale,
  currency: CurrencyCode,
): number | null {
  if (typeof input !== 'string') return null;

  let s = normaliseDigits(input);
  // Map Arabic numeric punctuation to ASCII so the locale rules below apply
  // uniformly when an AR user types from an Arabic keyboard.
  s = s.replace(/٫/g, ',').replace(/٬/g, '.');
  s = s.trim();
  if (s === '') return null;

  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  }

  // Drop everything that is not a digit, dot, or comma — currency markers
  // ("TND", "د.ت", "$", "€"), whitespace (incl. NBSP / NNBSP), letters,
  // all gone.
  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return null;

  const decimalChar = locale === 'en' ? '.' : ',';
  const groupChar = locale === 'en' ? ',' : '.';

  // Strip thousands grouping
  const ungrouped = s.split(groupChar).join('');

  // After stripping grouping, at most one decimal mark may remain.
  const parts = ungrouped.split(decimalChar);
  if (parts.length > 2) return null;

  const intPart = parts[0] ?? '';
  const fracPart = parts[1] ?? '';

  if (intPart === '' && fracPart === '') return null;
  if (intPart !== '' && !/^\d+$/.test(intPart)) return null;
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null;

  const minorDigits = getMinorUnitDigits(currency);
  // Reject precision that exceeds the minor unit — the user is asking for
  // sub-minor-unit resolution we don't have.
  if (fracPart.length > minorDigits) return null;

  const fracPadded = fracPart.padEnd(minorDigits, '0');
  const minorStr = `${intPart === '' ? '0' : intPart}${fracPadded}`;
  // Strip any leading zeros from the int portion before parsing — `Number`
  // handles it, but we want a clean integer.
  const minor = Number(minorStr);
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}
