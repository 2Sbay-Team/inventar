// Modern QR code SVG renderer — rounded data dots + rounded finder
// pattern corners. Replaces the plain QRCode.toString() path so that
// printed labels and the Settings preview show 2025-style QR codes.
//
// Architecture:
//   1. QRCode.create() returns the raw module matrix (synchronous).
//   2. We render data modules as SVG circles instead of filled squares.
//   3. The three corner finder patterns are drawn as three layered
//      rounded rectangles (outer ring + white middle + inner square)
//      rather than individual module circles, because a scanner expects
//      to see a solid-bordered square — not a grid of dots — in each
//      corner.
//
// The returned SVG string is compatible with injectQrCenterBranding
// (same viewBox="0 0 N N" convention, same </svg> tail).

import QRCode from 'qrcode';
import { parseHex } from '../theme/apply-theme';

// Default ink colour — matches the app's primary text colour.
const DEFAULT_DARK = '#1F2937';
const DEFAULT_LIGHT = '#FFFFFF';
// Circle radius in QR module units (1 unit = 1 module cell).
// 0.45 fills ~64 % of the cell — visually circular, scanner-friendly.
const DOT_R = 0.45;
// Rounded-corner radii for finder pattern elements.
// ~20 % of each rectangle's side length as specified in the brief.
const FINDER_OUTER_RX = 1.4; // 20 % of 7-module outer square
const FINDER_INNER_RX = 0.6; // 20 % of 3-module inner square

export interface ModernQrOptions {
  // Hex colour for QR dots / finder patterns. Validates with parseHex;
  // falls back to DEFAULT_DARK if null, undefined, or unparseable.
  darkColor?: string | null;
  // Background / quiet-zone colour. Defaults to white.
  lightColor?: string;
  // Quiet-zone width in module units on each side. Defaults to 1.
  margin?: number;
  // QR error-correction level. Defaults to 'H' (30 % tolerance) so
  // the centre branding overlay stays within the scanner's budget.
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

// Returns true for modules that belong to one of the three 7×7 finder
// patterns. We render those separately so the regular dot loop skips them.
function isInFinderZone(row: number, col: number, size: number): boolean {
  if (row < 7 && col < 7) return true; // top-left
  if (row < 7 && col >= size - 7) return true; // top-right
  if (row >= size - 7 && col < 7) return true; // bottom-left
  return false;
}

// Generates a modern QR code as an SVG string.
// Synchronous — uses QRCode.create() which does not do I/O.
export function generateModernQrSvg(content: string, options: ModernQrOptions = {}): string {
  const { lightColor = DEFAULT_LIGHT, margin = 1, errorCorrectionLevel = 'H' } = options;

  // Validate and resolve the dot colour.
  const darkColor =
    options.darkColor != null && parseHex(options.darkColor) != null
      ? options.darkColor
      : DEFAULT_DARK;

  const qr = QRCode.create(content, { errorCorrectionLevel });
  const size = qr.modules.size;
  const viewSize = size + 2 * margin;
  const parts: string[] = [];

  // Background / quiet-zone fill.
  parts.push(`<rect width="${viewSize}" height="${viewSize}" fill="${lightColor}"/>`);

  // Data modules — all non-finder dark cells become circles.
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (isInFinderZone(row, col, size)) continue;
      if (qr.modules.get(row, col) === 0) continue;
      const cx = margin + col + 0.5;
      const cy = margin + row + 0.5;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${DOT_R}" fill="${darkColor}"/>`);
    }
  }

  // Finder patterns — three layered rounded rectangles per corner.
  const finderOrigins: [number, number][] = [
    [0, 0], // top-left
    [0, size - 7], // top-right
    [size - 7, 0], // bottom-left
  ];

  for (const [fr, fc] of finderOrigins) {
    const x = margin + fc;
    const y = margin + fr;
    // Outer 7×7 filled rounded rect.
    parts.push(
      `<rect x="${x}" y="${y}" width="7" height="7" rx="${FINDER_OUTER_RX}" ry="${FINDER_OUTER_RX}" fill="${darkColor}"/>`,
    );
    // Middle 5×5 light rect — punches the ring hollow. Corner radius
    // scales proportionally from the outer rx so the curves align.
    const midRx = Number(((FINDER_OUTER_RX * 5) / 7).toFixed(3));
    parts.push(
      `<rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="${midRx}" ry="${midRx}" fill="${lightColor}"/>`,
    );
    // Inner 3×3 filled rounded rect.
    parts.push(
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${FINDER_INNER_RX}" ry="${FINDER_INNER_RX}" fill="${darkColor}"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="0 0 ${viewSize} ${viewSize}"` +
    ` shape-rendering="geometricPrecision">` +
    `${parts.join('')}</svg>`
  );
}
