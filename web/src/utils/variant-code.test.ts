import { describe, expect, it } from 'vitest';
import { parseVariantCode, variantCode } from './variant-code';

const article = { internal_code: 'SH-0001' };
const articleClothes = { internal_code: 'CL-0014' };
const articleKiosk = { internal_code: 'KI-0042' };

describe('variantCode', () => {
  it('emits PREFIX-NNNN-COLOR-SIZE for sized + coloured verticals (shoes)', () => {
    expect(
      variantCode(article, { color: 'black', size: '40' }, { hasColors: true, hasSizes: true }),
    ).toBe('SH-0001-BK-40');
  });

  it('keeps clothes XL distinct from L by using the explicit hyphen separator', () => {
    expect(
      variantCode(
        articleClothes,
        { color: 'black', size: 'XL' },
        { hasColors: true, hasSizes: true },
      ),
    ).toBe('CL-0014-BK-XL');
    expect(
      variantCode(
        articleClothes,
        { color: 'black', size: 'L' },
        { hasColors: true, hasSizes: true },
      ),
    ).toBe('CL-0014-BK-L');
    expect(
      variantCode(
        articleClothes,
        { color: 'black', size: 'XXL' },
        { hasColors: true, hasSizes: true },
      ),
    ).toBe('CL-0014-BK-XXL');
  });

  it('uses the CU + first-4-alnum rule for off-list custom colours', () => {
    expect(
      variantCode(article, { color: 'olive', size: '40' }, { hasColors: true, hasSizes: true }),
    ).toBe('SH-0001-CUOLIV-40');
  });

  it('drops the colour segment when the active vertical has no colours', () => {
    expect(
      variantCode(
        articleKiosk,
        { color: 'black', size: '500ml' },
        { hasColors: false, hasSizes: true },
      ),
    ).toBe('KI-0042-500ml');
  });

  it('drops the size segment when the active vertical has no sizes', () => {
    expect(
      variantCode(
        articleClothes,
        { color: 'black', size: null },
        { hasColors: true, hasSizes: false },
      ),
    ).toBe('CL-0014-BK');
  });

  it('emits just the article code for sizeless + colourless verticals', () => {
    expect(
      variantCode(articleKiosk, { color: null, size: null }, { hasColors: false, hasSizes: false }),
    ).toBe('KI-0042');
  });

  it('degrades a hasColors=true variant with null colour to the bare article code', () => {
    // The grammar PREFIX-NNNN[-COLOR[-SIZE]] does not permit an empty middle
    // segment, so a null colour drops the size as well — the resulting
    // article-level code keeps round-tripping cleanly through the parser.
    expect(
      variantCode(article, { color: null, size: '40' }, { hasColors: true, hasSizes: true }),
    ).toBe('SH-0001');
  });
});

describe('parseVariantCode', () => {
  it('returns 2-token article-only result for PREFIX-NNNN', () => {
    expect(parseVariantCode('SH-0001')).toEqual({
      internalCode: 'SH-0001',
      colorPrefix: '',
      size: '',
      tokenCount: 2,
    });
  });

  it('returns 3-token colour-only result for PREFIX-NNNN-COLOR', () => {
    expect(parseVariantCode('CL-0014-BK')).toEqual({
      internalCode: 'CL-0014',
      colorPrefix: 'BK',
      size: '',
      tokenCount: 3,
    });
  });

  it('returns 4-token full result for PREFIX-NNNN-COLOR-SIZE', () => {
    expect(parseVariantCode('SH-0001-BK-40')).toEqual({
      internalCode: 'SH-0001',
      colorPrefix: 'BK',
      size: '40',
      tokenCount: 4,
    });
  });

  it('parses a clothes XXL code without ambiguity', () => {
    expect(parseVariantCode('CL-0014-BK-XXL')).toEqual({
      internalCode: 'CL-0014',
      colorPrefix: 'BK',
      size: 'XXL',
      tokenCount: 4,
    });
  });

  it('parses a custom-colour 4-char code (CUOLIV)', () => {
    expect(parseVariantCode('SH-0001-CUOLIV-40')).toEqual({
      internalCode: 'SH-0001',
      colorPrefix: 'CUOLIV',
      size: '40',
      tokenCount: 4,
    });
  });

  it('rejects codes with more than 4 tokens (malformed)', () => {
    expect(parseVariantCode('SH-0001-BK-40-EXTRA')).toBeNull();
  });

  it('rejects single-token strings', () => {
    expect(parseVariantCode('SH0001')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(parseVariantCode('')).toBeNull();
    expect(parseVariantCode('   ')).toBeNull();
  });

  it('rejects codes whose first or second segment is empty', () => {
    expect(parseVariantCode('-0001')).toBeNull();
    expect(parseVariantCode('SH-')).toBeNull();
  });

  it('round-trips: variantCode → parseVariantCode reproduces the original', () => {
    const code = variantCode(
      article,
      { color: 'black', size: '40' },
      { hasColors: true, hasSizes: true },
    );
    const parsed = parseVariantCode(code);
    expect(parsed?.internalCode).toBe('SH-0001');
    expect(parsed?.colorPrefix).toBe('BK');
    expect(parsed?.size).toBe('40');
  });
});
