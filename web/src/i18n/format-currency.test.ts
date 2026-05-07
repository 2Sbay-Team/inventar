import { describe, expect, it } from 'vitest';
import { formatCurrency } from './format-currency';

// Currency formatting goes through Intl.NumberFormat, whose exact output
// (currency symbol position, NBSP variant, spacing around "TND") varies
// across Node / ICU versions. Tests assert on the stable invariants:
//   - the digits, decimal mark, and 3 fraction digits
//   - the locale-appropriate digit script (Western vs Eastern)
//   - the presence of a currency marker

describe('formatCurrency', () => {
  describe('en locale', () => {
    it('renders 1 TND (1000 millimes) with 3 fraction digits in Western digits', () => {
      const out = formatCurrency(1000, 'en');
      expect(out).toMatch(/1\.000/);
      expect(out).toMatch(/TND|TD/);
    });

    it('renders 12 millimes as 0.012 TND', () => {
      expect(formatCurrency(12, 'en')).toMatch(/0\.012/);
    });

    it('renders zero', () => {
      expect(formatCurrency(0, 'en')).toMatch(/0\.000/);
    });

    it('renders thousands with comma grouping', () => {
      // 1,234 TND = 1,234,000 millimes
      expect(formatCurrency(1_234_000, 'en')).toMatch(/1,234\.000/);
    });
  });

  describe('fr locale', () => {
    it('renders 1 TND with comma decimal and 3 fraction digits', () => {
      expect(formatCurrency(1000, 'fr')).toMatch(/1,000/);
    });

    it('renders 12 millimes as 0,012 TND', () => {
      expect(formatCurrency(12, 'fr')).toMatch(/0,012/);
    });

    it('renders 1 234,000 with NBSP grouping (any NBSP variant)', () => {
      const out = formatCurrency(1_234_000, 'fr');
      expect(out).toMatch(/1[\s  ]234,000/);
    });
  });

  describe('ar locale', () => {
    it('uses Eastern Arabic digits exclusively (no Western digits in output)', () => {
      expect(formatCurrency(1000, 'ar')).not.toMatch(/[0-9]/);
    });

    it('renders 1 TND with Eastern digits and a comma decimal', () => {
      const out = formatCurrency(1000, 'ar');
      expect(out).toContain('١,٠٠٠');
    });

    it('renders 12 millimes as ٠,٠١٢', () => {
      expect(formatCurrency(12, 'ar')).toContain('٠,٠١٢');
    });

    it('renders 1234 TND with grouping and Eastern digits', () => {
      const out = formatCurrency(1_234_000, 'ar');
      expect(out).toMatch(/١[\s  ]٢٣٤,٠٠٠/);
    });
  });

  it('always shows exactly 3 fraction digits regardless of locale (millime precision)', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const out = formatCurrency(1000, locale);
      // Find the digit run that contains the decimal mark and assert it has
      // 3 digits after the mark. Works for both '.' (en) and ',' (fr/ar).
      const match = out.match(/\d[.,](\d+)|[٠-٩][.,]([٠-٩]+)/);
      const fraction = match?.[1] ?? match?.[2] ?? '';
      expect(fraction.length).toBe(3);
    }
  });
});
