import { describe, expect, it } from 'vitest';
import { ean13Checksum, isPlausibleScannableCode, normalizeEan } from './ean';

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

  it('returns 5 (not 9) for the brief fixture, confirming it would fail strict validation', () => {
    // First 12 digits of 5449000000996 are "544900000009" — the
    // canonical checksum for those is 5, while the brief's value
    // claims 9 in the 13th position. That mismatch is exactly what
    // motivates the loose-validation default for v0.5.
    expect(ean13Checksum('544900000009')).toBe(5);
  });

  it('throws on non-12-digit input', () => {
    expect(() => ean13Checksum('1234567890123')).toThrow();
    expect(() => ean13Checksum('abc')).toThrow();
  });
});
