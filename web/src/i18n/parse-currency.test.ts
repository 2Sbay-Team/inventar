import { describe, expect, it } from 'vitest';
import { formatCurrency } from './format-currency';
import { parseCurrency } from './parse-currency';

describe('parseCurrency — TND (3 minor digits)', () => {
  describe('en locale', () => {
    it('parses a whole-TND integer', () => {
      expect(parseCurrency('1', 'en', 'TND')).toBe(1000);
      expect(parseCurrency('42', 'en', 'TND')).toBe(42000);
      expect(parseCurrency('0', 'en', 'TND')).toBe(0);
    });

    it('parses dot-decimal input', () => {
      expect(parseCurrency('1.5', 'en', 'TND')).toBe(1500);
      expect(parseCurrency('0.012', 'en', 'TND')).toBe(12);
      expect(parseCurrency('0.001', 'en', 'TND')).toBe(1);
    });

    it('strips comma thousands grouping', () => {
      expect(parseCurrency('1,234', 'en', 'TND')).toBe(1_234_000);
      expect(parseCurrency('1,234.567', 'en', 'TND')).toBe(1_234_567);
      expect(parseCurrency('1,000,000', 'en', 'TND')).toBe(1_000_000_000);
    });

    it('rejects more than 3 fraction digits for TND', () => {
      expect(parseCurrency('1.2345', 'en', 'TND')).toBeNull();
    });

    it('accepts ".5" (no leading zero)', () => {
      expect(parseCurrency('.5', 'en', 'TND')).toBe(500);
    });

    it('accepts "1." (trailing dot, no fraction)', () => {
      expect(parseCurrency('1.', 'en', 'TND')).toBe(1000);
    });
  });

  describe('fr locale', () => {
    it('parses a whole-TND integer', () => {
      expect(parseCurrency('1', 'fr', 'TND')).toBe(1000);
      expect(parseCurrency('42', 'fr', 'TND')).toBe(42000);
    });

    it('parses comma-decimal input', () => {
      expect(parseCurrency('1,5', 'fr', 'TND')).toBe(1500);
      expect(parseCurrency('0,012', 'fr', 'TND')).toBe(12);
      expect(parseCurrency('12,500', 'fr', 'TND')).toBe(12_500);
    });

    it('strips dot thousands grouping', () => {
      expect(parseCurrency('1.234', 'fr', 'TND')).toBe(1_234_000);
      expect(parseCurrency('1.234,567', 'fr', 'TND')).toBe(1_234_567);
    });

    it('strips NBSP and NNBSP whitespace grouping', () => {
      expect(parseCurrency('1 234', 'fr', 'TND')).toBe(1_234_000);
      expect(parseCurrency('1 234,567', 'fr', 'TND')).toBe(1_234_567);
      expect(parseCurrency('1 234,567', 'fr', 'TND')).toBe(1_234_567);
    });
  });

  describe('ar locale', () => {
    it('parses Eastern Arabic digits as integer TND', () => {
      expect(parseCurrency('٤٢', 'ar', 'TND')).toBe(42_000);
      expect(parseCurrency('٠', 'ar', 'TND')).toBe(0);
    });

    it('parses Eastern digits with comma decimal', () => {
      expect(parseCurrency('١٢,٥', 'ar', 'TND')).toBe(12_500);
      expect(parseCurrency('٠,٠١٢', 'ar', 'TND')).toBe(12);
    });

    it('strips Arabic thousands separator U+066C and uses U+066B as decimal', () => {
      expect(parseCurrency('١٬٢٣٤', 'ar', 'TND')).toBe(1_234_000);
      expect(parseCurrency('١٬٢٣٤٫٥٦٧', 'ar', 'TND')).toBe(1_234_567);
    });

    it('tolerates the TND currency marker mixed in', () => {
      expect(parseCurrency('١٢,٥٠٠ TND', 'ar', 'TND')).toBe(12_500);
      expect(parseCurrency('TND ١٢,٥٠٠', 'ar', 'TND')).toBe(12_500);
    });
  });

  describe('rejection cases (returns null, never throws)', () => {
    it('rejects empty / whitespace-only input', () => {
      expect(parseCurrency('', 'fr', 'TND')).toBeNull();
      expect(parseCurrency('   ', 'fr', 'TND')).toBeNull();
      expect(parseCurrency('\t\n', 'fr', 'TND')).toBeNull();
    });

    it('rejects letters-only input', () => {
      expect(parseCurrency('abc', 'fr', 'TND')).toBeNull();
      expect(parseCurrency('TND', 'fr', 'TND')).toBeNull();
    });

    it('rejects malformed decimal patterns', () => {
      expect(parseCurrency('1.2.3', 'en', 'TND')).toBeNull();
      expect(parseCurrency('1,2,3', 'fr', 'TND')).toBeNull();
    });

    it('rejects a bare decimal mark with no digits', () => {
      expect(parseCurrency('.', 'en', 'TND')).toBeNull();
      expect(parseCurrency(',', 'fr', 'TND')).toBeNull();
      expect(parseCurrency(',', 'ar', 'TND')).toBeNull();
    });

    it('rejects input where only the locale-foreign separator appears with no digits', () => {
      expect(parseCurrency('.', 'fr', 'TND')).toBeNull();
      expect(parseCurrency(',', 'en', 'TND')).toBeNull();
    });

    it('rejects non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(undefined as any, 'fr', 'TND')).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(null as any, 'fr', 'TND')).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(123 as any, 'fr', 'TND')).toBeNull();
    });
  });

  describe('negative amounts', () => {
    it('parses a leading minus', () => {
      expect(parseCurrency('-1', 'fr', 'TND')).toBe(-1000);
      expect(parseCurrency('-1,5', 'fr', 'TND')).toBe(-1500);
      expect(parseCurrency('-0.012', 'en', 'TND')).toBe(-12);
    });
  });

  describe('round-trip with formatCurrency (locale-internal exactness)', () => {
    const samples = [0, 1, 12, 999, 1000, 1234, 12_500, 1_234_567, 999_999_999];
    for (const locale of ['fr', 'ar', 'en'] as const) {
      for (const m of samples) {
        it(`format(${m}) → parse round-trips in ${locale} TND`, () => {
          const formatted = formatCurrency(m, locale, 'TND');
          expect(parseCurrency(formatted, locale, 'TND')).toBe(m);
        });
      }
    }
  });
});

describe('parseCurrency — other currencies (precision per CLDR)', () => {
  it('USD allows 2 fraction digits, rejects 3', () => {
    expect(parseCurrency('1.50', 'en', 'USD')).toBe(150);
    expect(parseCurrency('0.99', 'en', 'USD')).toBe(99);
    expect(parseCurrency('1.234', 'en', 'USD')).toBeNull();
  });

  it('EUR (fr) parses comma decimal at 2 digits', () => {
    expect(parseCurrency('1,50', 'fr', 'EUR')).toBe(150);
    expect(parseCurrency('1,5', 'fr', 'EUR')).toBe(150);
    expect(parseCurrency('1,234', 'fr', 'EUR')).toBeNull();
  });

  it('JPY rejects any fraction (yen has no minor unit)', () => {
    expect(parseCurrency('100', 'en', 'JPY')).toBe(100);
    expect(parseCurrency('100.0', 'en', 'JPY')).toBeNull();
    expect(parseCurrency('100.5', 'en', 'JPY')).toBeNull();
  });
});
