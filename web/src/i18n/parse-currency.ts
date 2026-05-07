import { type Locale } from '../types';
import { normaliseDigits } from '../query/normalise-digits';

// ADR-005: parse user-typed currency input back to integer millimes. Strict
// per-locale parsing — the rules mirror what `formatCurrency` outputs, so
// round-tripping `parse(format(x)) === x` holds for the locale the value was
// formatted in.
//   - en: '.' is the decimal mark, ',' is thousands grouping
//   - fr / ar: ',' is the decimal mark, '.' is thousands grouping
// NBSP grouping (U+00A0, U+202F) is tolerated in all locales.
//
// String arithmetic only — no float multiplication. Keeps the round-trip
// exact at millime precision.

const MILLIMES_PER_TND_DIGITS = 3;

export function parseCurrency(input: string, locale: Locale): number | null {
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
  // ("TND", "د.ت"), whitespace (incl. NBSP / NNBSP), letters, all gone.
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

  // Reject precision that exceeds millimes — the user is asking for sub-
  // millime resolution we don't have.
  if (fracPart.length > MILLIMES_PER_TND_DIGITS) return null;

  const fracPadded = fracPart.padEnd(MILLIMES_PER_TND_DIGITS, '0');
  const millimesStr = `${intPart === '' ? '0' : intPart}${fracPadded}`;
  // Strip any leading zeros from the int portion before parsing — `Number`
  // handles it, but we want a clean integer.
  const millimes = Number(millimesStr);
  if (!Number.isFinite(millimes)) return null;
  return negative ? -millimes : millimes;
}
