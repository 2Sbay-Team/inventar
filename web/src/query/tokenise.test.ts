import { describe, expect, it } from 'vitest';
import { tokenise } from './tokenise';

describe('tokenise', () => {
  it('splits on whitespace and lowercases', () => {
    expect(tokenise('White Running Shoe')).toEqual(['white', 'running', 'shoe']);
  });

  it('collapses runs of whitespace and trims leading / trailing space', () => {
    expect(tokenise('  white   shoe  ')).toEqual(['white', 'shoe']);
    expect(tokenise('white\tshoe\nblack')).toEqual(['white', 'shoe', 'black']);
  });

  it('returns an empty array for empty / whitespace-only input', () => {
    expect(tokenise('')).toEqual([]);
    expect(tokenise('   ')).toEqual([]);
    expect(tokenise('\n\t')).toEqual([]);
  });

  it('normalises Eastern Arabic digits to Western', () => {
    expect(tokenise('size ٤٢')).toEqual(['size', '42']);
    expect(tokenise('٤٢')).toEqual(['42']);
  });

  it('strips diacritics from FR tokens', () => {
    expect(tokenise('café noir')).toEqual(['cafe', 'noir']);
    expect(tokenise('Élève')).toEqual(['eleve']);
  });

  it('preserves Arabic harakat — DATA_MODEL §5 does not strip them; Tunisian input is unvocalised in practice', () => {
    // Sentinel: vocalised input does NOT collapse to the unvocalised form.
    // If product ever needs harakat-tolerant search, update DATA_MODEL §5
    // and this test together — never silently.
    expect(tokenise('أَبْيَض')).not.toEqual(['أبيض']);
  });

  it('produces the same tokens for the SPEC §1.4 trilingual equivalence', () => {
    // SPEC says these three queries should all find the same article.
    // After tokenise, the *digit* and *diacritic* parts canonicalise; the
    // colour-word equivalence ("white" ↔ "أبيض" ↔ "blanc") is handled by
    // search_blob containing all three forms — not by this function.
    expect(tokenise('white 42')).toEqual(['white', '42']);
    expect(tokenise('أبيض ٤٢')).toEqual(['أبيض', '42']);
    expect(tokenise('blanc 42')).toEqual(['blanc', '42']);
  });
});
