import { describe, expect, it } from 'vitest';
import { calculateContrast, getSafeQrColor } from './color-contrast';

// Reference values cross-checked against the WebAIM contrast checker.

describe('calculateContrast', () => {
  it('black on white = 21:1 (max ratio)', () => {
    expect(calculateContrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('white on white = 1:1 (no contrast)', () => {
    expect(calculateContrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 3);
  });

  it('mid-grey (#808080) on white ≈ 3.95:1 (below AA)', () => {
    // WebAIM reports 3.95:1 for #808080 on #FFFFFF.
    expect(calculateContrast('#808080', '#FFFFFF')).toBeCloseTo(3.95, 0);
  });

  it('dark navy (#1E3A8A) on white ≥ 4.5:1 (passes WCAG AA)', () => {
    expect(calculateContrast('#1E3A8A', '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('bright yellow (#FFFF00) on white < 4.5:1 (fails WCAG AA)', () => {
    expect(calculateContrast('#FFFF00', '#FFFFFF')).toBeLessThan(4.5);
  });

  it('returns 1 for invalid hex strings (worst-case fallback)', () => {
    expect(calculateContrast('not-a-color', '#FFFFFF')).toBe(1);
    expect(calculateContrast('#FFFFFF', 'bad')).toBe(1);
  });

  it('accepts 3-digit shorthand hex', () => {
    // #000 === #000000
    expect(calculateContrast('#000', '#fff')).toBeCloseTo(21, 0);
  });

  it('is symmetric — contrast(A, B) === contrast(B, A)', () => {
    const ab = calculateContrast('#1E3A8A', '#FFFFFF');
    const ba = calculateContrast('#FFFFFF', '#1E3A8A');
    expect(ab).toBeCloseTo(ba, 10);
  });
});

describe('getSafeQrColor', () => {
  it('returns the brand color when contrast ≥ 4.5:1 against white', () => {
    // #1E3A8A (navy) has contrast well above 4.5:1.
    expect(getSafeQrColor('#1E3A8A')).toBe('#1E3A8A');
  });

  it('returns #000000 when brand color is too light (< 4.5:1 vs white)', () => {
    // #FFFF00 (yellow) is invisible on white — fallback to black.
    expect(getSafeQrColor('#FFFF00')).toBe('#000000');
  });

  it('returns #000000 when brand color is null', () => {
    expect(getSafeQrColor(null)).toBe('#000000');
  });

  it('returns #000000 when brand color is undefined', () => {
    expect(getSafeQrColor(undefined)).toBe('#000000');
  });

  it('returns #000000 for an invalid hex string', () => {
    expect(getSafeQrColor('not-a-color')).toBe('#000000');
  });

  it('preserves exact case of the caller-supplied hex when contrast passes', () => {
    // getSafeQrColor must return what the caller passed, not normalised.
    // #1e3a8a (navy) has high contrast against white — verify the hex
    // string is returned verbatim with its original casing.
    expect(getSafeQrColor('#1e3a8a')).toBe('#1e3a8a');
  });

  it('mid-grey #808080 (contrast ~3.95:1) → fallback to #000000', () => {
    expect(getSafeQrColor('#808080')).toBe('#000000');
  });

  it('app default orange #FF6B35 meets WCAG AA (contrast ≈ 3.0:1, fails)', () => {
    // The app's accent orange is ~3.0:1 — below the 4.5 threshold.
    expect(getSafeQrColor('#FF6B35')).toBe('#000000');
  });
});
