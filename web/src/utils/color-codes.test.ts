import { describe, expect, it } from 'vitest';
import { CANONICAL_COLOR_PREFIX, colorPrefix } from './color-codes';
import { CANONICAL_COLOURS } from '../query/colour-aliases';

describe('colorPrefix', () => {
  it('returns null for null input (sizeless / colourless variants)', () => {
    expect(colorPrefix(null)).toBeNull();
  });

  it('returns null for whitespace-only strings', () => {
    expect(colorPrefix('')).toBeNull();
    expect(colorPrefix('   ')).toBeNull();
  });

  it('covers every canonical colour from the alias table', () => {
    for (const c of CANONICAL_COLOURS) {
      const code = colorPrefix(c);
      expect(code, `missing prefix for ${c}`).toBe(CANONICAL_COLOR_PREFIX[c]);
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('is case-insensitive for canonical lookups', () => {
    expect(colorPrefix('Black')).toBe('BK');
    expect(colorPrefix('BLACK')).toBe('BK');
    expect(colorPrefix('  black  ')).toBe('BK');
  });

  it('emits CU + first 4 alnum chars uppercased for off-list colours', () => {
    expect(colorPrefix('olive')).toBe('CUOLIV');
    expect(colorPrefix('burgundy')).toBe('CUBURG');
  });

  it('strips diacritics before slicing custom colours', () => {
    expect(colorPrefix('doré')).toBe('CUDORE');
    expect(colorPrefix('argenté')).toBe('CUARGE');
  });

  it('drops non-alphanumeric characters from custom colours', () => {
    expect(colorPrefix('royal blue')).toBe('CUROYA');
    expect(colorPrefix('off-white-2')).toBe('CUOFFW');
  });

  it('handles short customs without padding', () => {
    expect(colorPrefix('lime')).toBe('CULIME');
    expect(colorPrefix('tan')).toBe('CUTAN');
  });

  it('falls back to bare CU when the input has no extractable alnum', () => {
    expect(colorPrefix('!!!')).toBe('CU');
    expect(colorPrefix('—')).toBe('CU');
  });

  it('every canonical prefix in the table is exactly two ASCII letters', () => {
    for (const code of Object.values(CANONICAL_COLOR_PREFIX)) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('every canonical prefix is unique', () => {
    const codes = Object.values(CANONICAL_COLOR_PREFIX);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
