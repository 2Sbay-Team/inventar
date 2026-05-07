import { describe, expect, it } from 'vitest';
import { stripDiacritics } from './strip-diacritics';

describe('stripDiacritics', () => {
  it('strips French acute / grave / circumflex / cedilla', () => {
    expect(stripDiacritics('café')).toBe('cafe');
    expect(stripDiacritics('élève')).toBe('eleve');
    expect(stripDiacritics('forêt')).toBe('foret');
    expect(stripDiacritics('garçon')).toBe('garcon');
    expect(stripDiacritics('naïve')).toBe('naive');
  });

  it('preserves case (does not lowercase — that is the caller’s job)', () => {
    expect(stripDiacritics('CAFÉ')).toBe('CAFE');
    expect(stripDiacritics('Élève')).toBe('Eleve');
  });

  it('handles already-precomposed input (NFC) by NFD-decomposing first', () => {
    // 'é' may arrive as a single precomposed code point (U+00E9). NFD splits it
    // into 'e' + U+0301 (combining acute), which the regex then strips.
    const precomposed = 'é';
    expect(precomposed.length).toBe(1);
    expect(stripDiacritics(precomposed)).toBe('e');
  });

  it('passes plain ASCII through unchanged', () => {
    expect(stripDiacritics('white running shoe')).toBe('white running shoe');
    expect(stripDiacritics('SH-0042')).toBe('SH-0042');
  });

  it('passes the empty string through unchanged', () => {
    expect(stripDiacritics('')).toBe('');
  });

  it('returns precomposed Arabic verbatim — NFC at the end recomposes after a no-op decompose/strip', () => {
    // 'أبيض' is precomposed (alef-with-hamza-above + ب + ي + ض). NFD splits
    // the alef-hamza into ا + U+0654; U+0654 is OUTSIDE the Latin strip
    // range, so nothing is stripped; NFC recomposes back to the original.
    expect(stripDiacritics('أبيض')).toBe('أبيض');
  });

  it('preserves Arabic harakat (out of scope per DATA_MODEL §5 — Tunisian input is unvocalised)', () => {
    // Spec lock-in: if someone widens the strip range to include Arabic
    // tashkil (U+064B..U+065F) without updating DATA_MODEL §5, this test
    // catches it. The behaviour is intentional, not a bug.
    const vocalised = 'أَبْيَض';
    const out = stripDiacritics(vocalised);
    expect(out).toContain('َ'); // U+064E fatha — preserved
    expect(out).not.toBe('أبيض'); // not collapsed to the unvocalised form
  });

  it('is idempotent — applying twice equals applying once', () => {
    for (const input of ['café', 'élève', 'أبيض', 'أَبْيَض', 'plain', '']) {
      expect(stripDiacritics(stripDiacritics(input))).toBe(stripDiacritics(input));
    }
  });
});
