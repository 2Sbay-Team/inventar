import { describe, expect, it } from 'vitest';
import { normaliseDigits } from './normalise-digits';

describe('normaliseDigits', () => {
  it('maps each Eastern Arabic digit to its Western counterpart', () => {
    expect(normaliseDigits('٠')).toBe('0');
    expect(normaliseDigits('١')).toBe('1');
    expect(normaliseDigits('٢')).toBe('2');
    expect(normaliseDigits('٣')).toBe('3');
    expect(normaliseDigits('٤')).toBe('4');
    expect(normaliseDigits('٥')).toBe('5');
    expect(normaliseDigits('٦')).toBe('6');
    expect(normaliseDigits('٧')).toBe('7');
    expect(normaliseDigits('٨')).toBe('8');
    expect(normaliseDigits('٩')).toBe('9');
  });

  it('preserves an all-Western input verbatim', () => {
    expect(normaliseDigits('white 42')).toBe('white 42');
    expect(normaliseDigits('0123456789')).toBe('0123456789');
  });

  it('preserves the empty string', () => {
    expect(normaliseDigits('')).toBe('');
  });

  it('canonicalises mixed Arabic + Western input', () => {
    expect(normaliseDigits('size ٤٢')).toBe('size 42');
    expect(normaliseDigits('٤2')).toBe('42');
  });

  it('leaves Arabic letters and punctuation untouched', () => {
    expect(normaliseDigits('أبيض')).toBe('أبيض');
    expect(normaliseDigits('أبيض ٤٢')).toBe('أبيض 42');
    expect(normaliseDigits('a-٤2_x')).toBe('a-42_x');
  });

  it('leaves Extended Arabic-Indic (Persian/Urdu, U+06F0..U+06F9) untouched — out of scope per DATA_MODEL §5', () => {
    // The spec explicitly normalises only U+0660..U+0669. Persian digits
    // (U+06F0..U+06F9) are visually similar but a different code point range.
    expect(normaliseDigits('۴۲')).toBe('۴۲');
  });

  it('canonicalises the SPEC §1.4 search query example "أبيض ٤٢" so it can match "white 42"', () => {
    // Search behaviour from SPEC.md §1: "أبيض ٤٢" must find the same article
    // as "white 42". The digit half of that equivalence is this function's job.
    expect(normaliseDigits('أبيض ٤٢')).toBe('أبيض 42');
  });
});
