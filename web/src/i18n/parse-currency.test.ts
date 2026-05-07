import { describe, expect, it } from 'vitest';
import { formatCurrency } from './format-currency';
import { parseCurrency } from './parse-currency';

describe('parseCurrency', () => {
  describe('en locale', () => {
    it('parses a whole-TND integer', () => {
      expect(parseCurrency('1', 'en')).toBe(1000);
      expect(parseCurrency('42', 'en')).toBe(42000);
      expect(parseCurrency('0', 'en')).toBe(0);
    });

    it('parses dot-decimal input', () => {
      expect(parseCurrency('1.5', 'en')).toBe(1500);
      expect(parseCurrency('0.012', 'en')).toBe(12);
      expect(parseCurrency('0.001', 'en')).toBe(1);
    });

    it('strips comma thousands grouping', () => {
      expect(parseCurrency('1,234', 'en')).toBe(1_234_000);
      expect(parseCurrency('1,234.567', 'en')).toBe(1_234_567);
      expect(parseCurrency('1,000,000', 'en')).toBe(1_000_000_000);
    });

    it('rejects more than 3 fraction digits', () => {
      expect(parseCurrency('1.2345', 'en')).toBeNull();
    });

    it('accepts ".5" (no leading zero)', () => {
      expect(parseCurrency('.5', 'en')).toBe(500);
    });

    it('accepts "1." (trailing dot, no fraction)', () => {
      expect(parseCurrency('1.', 'en')).toBe(1000);
    });
  });

  describe('fr locale', () => {
    it('parses a whole-TND integer', () => {
      expect(parseCurrency('1', 'fr')).toBe(1000);
      expect(parseCurrency('42', 'fr')).toBe(42000);
    });

    it('parses comma-decimal input', () => {
      expect(parseCurrency('1,5', 'fr')).toBe(1500);
      expect(parseCurrency('0,012', 'fr')).toBe(12);
      expect(parseCurrency('12,500', 'fr')).toBe(12_500);
    });

    it('strips dot thousands grouping', () => {
      expect(parseCurrency('1.234', 'fr')).toBe(1_234_000);
      expect(parseCurrency('1.234,567', 'fr')).toBe(1_234_567);
    });

    it('strips NBSP and NNBSP whitespace grouping', () => {
      expect(parseCurrency('1 234', 'fr')).toBe(1_234_000);
      expect(parseCurrency('1 234,567', 'fr')).toBe(1_234_567);
      expect(parseCurrency('1 234,567', 'fr')).toBe(1_234_567);
    });
  });

  describe('ar locale', () => {
    it('parses Eastern Arabic digits as integer TND', () => {
      expect(parseCurrency('٤٢', 'ar')).toBe(42_000);
      expect(parseCurrency('٠', 'ar')).toBe(0);
    });

    it('parses Eastern digits with comma decimal', () => {
      expect(parseCurrency('١٢,٥', 'ar')).toBe(12_500);
      expect(parseCurrency('٠,٠١٢', 'ar')).toBe(12);
    });

    it('strips Arabic thousands separator U+066C and uses U+066B as decimal', () => {
      expect(parseCurrency('١٬٢٣٤', 'ar')).toBe(1_234_000);
      expect(parseCurrency('١٬٢٣٤٫٥٦٧', 'ar')).toBe(1_234_567);
    });

    it('tolerates the TND currency marker mixed in', () => {
      expect(parseCurrency('١٢,٥٠٠ TND', 'ar')).toBe(12_500);
      expect(parseCurrency('TND ١٢,٥٠٠', 'ar')).toBe(12_500);
    });
  });

  describe('rejection cases (returns null, never throws)', () => {
    it('rejects empty / whitespace-only input', () => {
      expect(parseCurrency('', 'fr')).toBeNull();
      expect(parseCurrency('   ', 'fr')).toBeNull();
      expect(parseCurrency('\t\n', 'fr')).toBeNull();
    });

    it('rejects letters-only input', () => {
      expect(parseCurrency('abc', 'fr')).toBeNull();
      expect(parseCurrency('TND', 'fr')).toBeNull();
    });

    it('rejects malformed decimal patterns', () => {
      expect(parseCurrency('1.2.3', 'en')).toBeNull(); // multiple dots in en
      expect(parseCurrency('1,2,3', 'fr')).toBeNull(); // multiple commas in fr
    });

    it('rejects a bare decimal mark with no digits', () => {
      // Hits the "intPart === '' && fracPart === ''" guard.
      expect(parseCurrency('.', 'en')).toBeNull();
      expect(parseCurrency(',', 'fr')).toBeNull();
      expect(parseCurrency(',', 'ar')).toBeNull();
    });

    it('rejects input where only the locale-foreign separator appears with no digits', () => {
      // '.' alone in fr — '.' is the group char, gets stripped → empty → null
      // at the early "after strip empty" guard.
      expect(parseCurrency('.', 'fr')).toBeNull();
      expect(parseCurrency(',', 'en')).toBeNull();
    });

    it('rejects non-string input', () => {
      // Defensive: callers may forward unknown values from form state.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(undefined as any, 'fr')).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(null as any, 'fr')).toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseCurrency(123 as any, 'fr')).toBeNull();
    });
  });

  describe('negative amounts', () => {
    it('parses a leading minus', () => {
      expect(parseCurrency('-1', 'fr')).toBe(-1000);
      expect(parseCurrency('-1,5', 'fr')).toBe(-1500);
      expect(parseCurrency('-0.012', 'en')).toBe(-12);
    });
  });

  describe('round-trip with formatCurrency (locale-internal exactness)', () => {
    // Spec contract: parsing the formatted output of any millime amount in
    // the same locale must return that exact amount. This is the test that
    // catches subtle drift in either function.
    const samples = [0, 1, 12, 999, 1000, 1234, 12_500, 1_234_567, 999_999_999];
    for (const locale of ['fr', 'ar', 'en'] as const) {
      for (const m of samples) {
        it(`format(${m}) → parse round-trips in ${locale}`, () => {
          const formatted = formatCurrency(m, locale);
          expect(parseCurrency(formatted, locale)).toBe(m);
        });
      }
    }
  });
});
