import { describe, expect, it } from 'vitest';
import { parseQuery } from './parse-query';

describe('parseQuery', () => {
  it('classifies numeric tokens as sizes and the rest as general', () => {
    const q = parseQuery('white 42');
    expect(q.sizeTokens).toEqual(['42']);
    expect(q.generalTokens).toHaveLength(1);
    expect(q.generalTokens[0]).toEqual(expect.arrayContaining(['white', 'blanc', 'أبيض']));
  });

  it('normalises Eastern Arabic digits in size tokens', () => {
    expect(parseQuery('٤٢').sizeTokens).toEqual(['42']);
  });

  it('strips French diacritics so "blanc" matches the same alias group as "white"', () => {
    const a = parseQuery('blanc');
    const b = parseQuery('white');
    expect(a.generalTokens[0]).toEqual(b.generalTokens[0]);
  });

  it('treats Arabic colour words as the same alias group', () => {
    const a = parseQuery('أبيض');
    expect(a.generalTokens[0]).toEqual(expect.arrayContaining(['أبيض', 'white', 'blanc']));
  });

  it('falls back to a single-token group for unknown words', () => {
    const q = parseQuery('lotto');
    expect(q.generalTokens).toEqual([['lotto']]);
    expect(q.sizeTokens).toEqual([]);
  });

  it('reports isEmpty for whitespace-only input', () => {
    expect(parseQuery('').isEmpty).toBe(true);
    expect(parseQuery('   ').isEmpty).toBe(true);
  });

  it('collapses redundant spaces and case folds', () => {
    expect(parseQuery('WHITE  42').sizeTokens).toEqual(['42']);
  });
});
