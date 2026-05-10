import { describe, expect, it } from 'vitest';
import { classifyScan } from './scan-classify';

describe('classifyScan', () => {
  it('returns article_url for the production-origin QR shape', () => {
    const r = classifyScan(
      'https://inventar.hoodhood.ai/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    expect(r).toEqual({
      kind: 'article_url',
      articleId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  it('lowercases the captured uuid so DB lookups are case-insensitive', () => {
    const r = classifyScan('https://example.com/article/AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE');
    expect(r).toEqual({
      kind: 'article_url',
      articleId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
  });

  it('matches both http and https origins', () => {
    const r = classifyScan('http://localhost:5173/article/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(r?.kind).toBe('article_url');
  });

  it('classifies 8/12/13/14-digit numeric input as ean', () => {
    expect(classifyScan('5449000000996')).toEqual({ kind: 'ean', value: '5449000000996' });
    expect(classifyScan('012345678905')).toEqual({ kind: 'ean', value: '012345678905' });
    expect(classifyScan('12345670')).toEqual({ kind: 'ean', value: '12345670' });
    expect(classifyScan('12345678901234')).toEqual({ kind: 'ean', value: '12345678901234' });
  });

  it('classifies short alphanumerics as internal_code', () => {
    expect(classifyScan('SH-0042')).toEqual({ kind: 'internal_code', value: 'SH-0042' });
    expect(classifyScan('GR-12')).toEqual({ kind: 'internal_code', value: 'GR-12' });
  });

  it('trims whitespace before classifying', () => {
    expect(classifyScan('  SH-0042  ')).toEqual({ kind: 'internal_code', value: 'SH-0042' });
    expect(classifyScan('\t5449000000996\n')).toEqual({ kind: 'ean', value: '5449000000996' });
  });

  it('returns null for empty/whitespace-only input', () => {
    expect(classifyScan('')).toBeNull();
    expect(classifyScan('   ')).toBeNull();
  });

  it('returns null for tokens longer than 32 chars (no DB lookup attempted)', () => {
    expect(classifyScan('A'.repeat(33))).toBeNull();
  });

  it('falls through to internal_code for short non-/article URLs (best-effort lookup)', () => {
    expect(classifyScan('https://example.com/list')).toEqual({
      kind: 'internal_code',
      value: 'https://example.com/list',
    });
  });

  it('returns null for long non-/article URLs (over 32 chars)', () => {
    expect(classifyScan('https://inventar.hoodhood.ai/list')).toBeNull();
  });
});
