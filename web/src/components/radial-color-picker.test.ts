import { describe, expect, it } from 'vitest';
import { hexToHue, hslToHex } from './radial-color-picker';

describe('hexToHue', () => {
  it('returns 0 for pure red', () => {
    expect(hexToHue('#ff0000')).toBe(0);
  });

  it('returns 0 for uppercase red', () => {
    expect(hexToHue('#FF0000')).toBe(0);
  });

  it('returns 120 for pure green', () => {
    expect(hexToHue('#00ff00')).toBe(120);
  });

  it('returns 240 for pure blue', () => {
    expect(hexToHue('#0000ff')).toBe(240);
  });

  it('returns 0 for grey (monochrome)', () => {
    expect(hexToHue('#808080')).toBe(0);
  });

  it('returns 0 for white', () => {
    expect(hexToHue('#ffffff')).toBe(0);
  });

  it('returns 0 for malformed hex', () => {
    expect(hexToHue('not-a-hex')).toBe(0);
  });
});

describe('hslToHex', () => {
  it('returns red for hue=0', () => {
    // hsl(0, 70%, 55%) is a vivid red
    const hex = hslToHex(0, 70, 55);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    // Red channel should dominate
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    expect(r).toBeGreaterThan(g);
  });

  it('returns greenish for hue=120', () => {
    const hex = hslToHex(120, 70, 55);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    // Green channel should dominate
    const g = parseInt(hex.slice(3, 5), 16);
    const r = parseInt(hex.slice(1, 3), 16);
    expect(g).toBeGreaterThan(r);
  });

  it('returns bluish for hue=240', () => {
    const hex = hslToHex(240, 70, 55);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const b = parseInt(hex.slice(5, 7), 16);
    const r = parseInt(hex.slice(1, 3), 16);
    expect(b).toBeGreaterThan(r);
  });

  it('round-trips hue through hex: hsl(180°) → hex → hue ≈ 180°', () => {
    const hex = hslToHex(180, 70, 55);
    const recovered = hexToHue(hex);
    // Allow ±5° rounding from hex quantisation
    expect(Math.abs(recovered - 180)).toBeLessThanOrEqual(5);
  });

  it('always returns a valid 7-char lowercase hex string', () => {
    for (const hue of [0, 60, 120, 180, 240, 300, 355]) {
      const hex = hslToHex(hue, 70, 55);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
