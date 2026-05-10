import { describe, expect, it } from 'vitest';
import { ean13Checksum, isPlausibleScannableCode, isValidStrictEan13, normalizeEan } from './ean';

describe('normalizeEan', () => {
  it('strips ASCII whitespace from both ends', () => {
    expect(normalizeEan('  5901234123457  ')).toBe('5901234123457');
  });

  it('strips embedded whitespace too (some scanners interleave)', () => {
    expect(normalizeEan('5901 234 123 457')).toBe('5901234123457');
  });

  it('returns the input unchanged when there is no whitespace', () => {
    expect(normalizeEan('5901234123457')).toBe('5901234123457');
  });

  it('returns empty for whitespace-only input', () => {
    expect(normalizeEan('   ')).toBe('');
  });
});

describe('isPlausibleScannableCode', () => {
  it('accepts 13-digit input (EAN-13)', () => {
    expect(isPlausibleScannableCode('5901234123457')).toBe(true);
  });

  it('accepts 12-digit input (UPC-A)', () => {
    expect(isPlausibleScannableCode('012345678905')).toBe(true);
  });

  it('accepts the brief fixture value (loose mode does not check checksum)', () => {
    // 5449000000996 has check digit 9 but the strict checksum is 5.
    // Loose mode accepts it because length + digit-only both pass.
    expect(isPlausibleScannableCode('5449000000996')).toBe(true);
  });

  it('normalises whitespace before validating', () => {
    expect(isPlausibleScannableCode('  5901234123457  ')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isPlausibleScannableCode('')).toBe(false);
    expect(isPlausibleScannableCode('   ')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isPlausibleScannableCode('5901234abc456')).toBe(false);
    expect(isPlausibleScannableCode('590-1234-1234')).toBe(false);
  });

  it('rejects wrong lengths', () => {
    expect(isPlausibleScannableCode('1')).toBe(false);
    expect(isPlausibleScannableCode('12345')).toBe(false);
    expect(isPlausibleScannableCode('1234567890')).toBe(false); // 10 digits
    expect(isPlausibleScannableCode('12345678901234')).toBe(false); // 14 digits
  });
});

describe('ean13Checksum', () => {
  it('matches the published check digit for 5901234123457', () => {
    // 5901234123457 — checksum 7, computed from "590123412345".
    expect(ean13Checksum('590123412345')).toBe(7);
  });

  it('matches the published check digit for the ISBN-13 9780201379624', () => {
    expect(ean13Checksum('978020137962')).toBe(4);
  });

  it('returns 5 for "544900000009" (independent fixture)', () => {
    // Earlier comments (and earlier commit messages) claimed the v0.5
    // brief's test EAN 5449000000996 had a wrong check digit. That
    // was a miscount: the brief value has 6 zeros and is a fully
    // valid EAN-13 (checksum = 6 — see strict tests below). The
    // string here is a different sequence ("544900000009", 12 digits
    // ending in a single 9) chosen because its computed checksum (5)
    // is a stable independent fixture for the algorithm.
    expect(ean13Checksum('544900000009')).toBe(5);
  });

  it('throws on non-12-digit input', () => {
    expect(() => ean13Checksum('1234567890123')).toThrow();
    expect(() => ean13Checksum('abc')).toThrow();
  });
});

describe('isValidStrictEan13', () => {
  it('accepts 5901234123457 (real EAN, checksum 7)', () => {
    expect(isValidStrictEan13('5901234123457')).toBe(true);
  });

  it('accepts the ISBN-13 9780201379624 (checksum 4)', () => {
    expect(isValidStrictEan13('9780201379624')).toBe(true);
  });

  it('accepts the v0.5 brief fixture 5449000000996 (it IS a valid EAN-13)', () => {
    // The earlier "loose only because the brief fixture is invalid"
    // narrative was wrong — careful counting shows 5449000000996 has
    // 6 zeros (not 7) and computes to checksum 6, which matches its
    // 13th digit. Loose validation is still the v0.5 default for the
    // OTHER reason: many real Tunisian retail barcodes (UPC-A,
    // in-house codes) wouldn't pass strict.
    expect(isValidStrictEan13('5449000000996')).toBe(true);
  });

  it('rejects a checksum-invalid 13-digit string (5901234123450 — last digit should be 7)', () => {
    expect(isValidStrictEan13('5901234123450')).toBe(false);
  });

  it('rejects UPC-A length (12 digits)', () => {
    // UPC-A is valid in loose mode; strict only accepts EAN-13.
    expect(isValidStrictEan13('012345678905')).toBe(false);
  });

  it('rejects empty / non-digit / wrong length', () => {
    expect(isValidStrictEan13('')).toBe(false);
    expect(isValidStrictEan13('abc')).toBe(false);
    expect(isValidStrictEan13('123')).toBe(false);
    expect(isValidStrictEan13('12345678901234')).toBe(false);
  });

  it('strips whitespace before validating', () => {
    expect(isValidStrictEan13('  5901234123457  ')).toBe(true);
    expect(isValidStrictEan13('590 123 412 3457')).toBe(true);
  });
});
