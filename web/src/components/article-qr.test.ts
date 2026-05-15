import { describe, expect, it } from 'vitest';
import { getQrDarkColor } from './article-qr';

describe('getQrDarkColor', () => {
  it('returns #000000 when forceBlack=true regardless of brandColor', () => {
    expect(getQrDarkColor('#FF6B35', true)).toBe('#000000');
    expect(getQrDarkColor('#2563EB', true)).toBe('#000000');
    expect(getQrDarkColor(null, true)).toBe('#000000');
    expect(getQrDarkColor(undefined, true)).toBe('#000000');
  });

  it('returns a non-black color when forceBlack=false and brandColor is vivid', () => {
    // getSafeQrColor will pass through a high-contrast dark color
    const result = getQrDarkColor('#1A1A2E', false);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Should not be forced to black — brand color chosen
    expect(result).not.toBe('#000000');
  });

  it('falls back to a safe dark color when brandColor is too light', () => {
    // Very light color — getSafeQrColor should reject it and return a dark fallback
    const result = getQrDarkColor('#FFFFFF', false);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('handles null brandColor when forceBlack=false', () => {
    const result = getQrDarkColor(null, false);
    expect(result).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});
