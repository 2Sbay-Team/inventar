// Stable two-letter prefixes for the 16 canonical colours, plus a
// `CU + first 4 alnum chars uppercased` rule for off-list customs. Used by
// utils/variant-code.ts when stamping a human-readable variant code onto a
// printed shelf label or a QR payload. Per ADR-013 (and the v0.3 plan
// answer 2), every canonical colour gets a deterministic prefix so the same
// colour produces the same label across devices and across time.

import { CANONICAL_COLOURS, type CanonicalColour } from '../query/colour-aliases';
import { stripDiacritics } from '../query/strip-diacritics';

export const CANONICAL_COLOR_PREFIX: Record<CanonicalColour, string> = {
  white: 'WH',
  black: 'BK',
  gray: 'GY',
  brown: 'BR',
  beige: 'BE',
  red: 'RE',
  orange: 'OR',
  yellow: 'YE',
  green: 'GR',
  blue: 'BL',
  navy: 'NV',
  purple: 'PU',
  pink: 'PI',
  gold: 'GO',
  silver: 'SI',
  multi: 'MC',
};

export const CUSTOM_PREFIX = 'CU';

function isCanonical(c: string): c is CanonicalColour {
  return (CANONICAL_COLOURS as readonly string[]).includes(c);
}

// Returns the prefix for a colour string. Null input → null (sizeless verticals
// or colourless rows). Canonical colours get the table entry. Anything else
// gets `CU` + the first four alphanumeric characters of the input, uppercased.
// Diacritics are stripped via NFD before slicing so "doré" → "CUDORE" cleanly.
export function colorPrefix(color: string | null): string | null {
  if (color === null) return null;
  const trimmed = color.trim().toLowerCase();
  if (trimmed === '') return null;
  if (isCanonical(trimmed)) return CANONICAL_COLOR_PREFIX[trimmed];
  const alnum = stripDiacritics(trimmed)
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase();
  if (alnum.length === 0) return CUSTOM_PREFIX;
  return CUSTOM_PREFIX + alnum.slice(0, 4);
}
