// WCAG 2.x contrast ratio utilities for choosing accessible QR ink colors.
//
// QR codes must remain scannable on white label stock regardless of the
// merchant's brand colour. The WCAG AA large-text threshold of 4.5:1
// against white is conservative but gives every brand colour a reliable
// scan distance even at small print sizes.

import { parseHex, type Rgb } from '../theme/apply-theme';

// Relative luminance per IEC 61966-2-1 (sRGB linearisation).
function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// WCAG 2.x contrast ratio between two hex strings.
// Returns a value in [1, 21]. Unparseable input → 1 (worst case).
export function calculateContrast(hexA: string, hexB: string): number {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  if (!a || !b) return 1;
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Returns `brandColor` when it meets WCAG AA (≥4.5:1) against white, or
// '#000000' when it's too light to remain legible on a white label.
// Null / undefined / invalid hex all fall back to black.
export function getSafeQrColor(brandColor: string | null | undefined): string {
  if (!brandColor) return '#000000';
  return calculateContrast(brandColor, '#FFFFFF') >= 4.5 ? brandColor : '#000000';
}
