import { describe, expect, it } from 'vitest';
import { formatCurrency } from './format-currency';

// Currency formatting goes through Intl.NumberFormat, whose exact output
// (currency symbol position, NBSP variant, spacing around the marker)
// varies across Node / ICU versions. Tests assert on the stable invariants:
//   - the digits, decimal mark, and fraction-digit count
//   - the locale-appropriate digit script (Western vs Eastern)
//   - the presence of a currency marker

describe('formatCurrency — TND (3 minor digits)', () => {
  describe('en locale', () => {
    it('renders 1 TND (1000 millimes) with 3 fraction digits in Western digits', () => {
      const out = formatCurrency(1000, 'en', 'TND');
      expect(out).toMatch(/1\.000/);
      expect(out).toMatch(/TND|TD/);
    });

    it('renders 12 millimes as 0.012 TND', () => {
      expect(formatCurrency(12, 'en', 'TND')).toMatch(/0\.012/);
    });

    it('renders zero', () => {
      expect(formatCurrency(0, 'en', 'TND')).toMatch(/0\.000/);
    });

    it('renders thousands with comma grouping', () => {
      // 1,234 TND = 1,234,000 millimes
      expect(formatCurrency(1_234_000, 'en', 'TND')).toMatch(/1,234\.000/);
    });
  });

  describe('fr locale', () => {
    it('renders 1 TND with comma decimal and 3 fraction digits', () => {
      expect(formatCurrency(1000, 'fr', 'TND')).toMatch(/1,000/);
    });

    it('renders 12 millimes as 0,012 TND', () => {
      expect(formatCurrency(12, 'fr', 'TND')).toMatch(/0,012/);
    });

    it('renders 1 234,000 with NBSP grouping (any NBSP variant)', () => {
      const out = formatCurrency(1_234_000, 'fr', 'TND');
      expect(out).toMatch(/1[\s  ]234,000/);
    });
  });

  describe('ar locale', () => {
    it('uses Eastern Arabic digits exclusively (no Western digits in output)', () => {
      expect(formatCurrency(1000, 'ar', 'TND')).not.toMatch(/[0-9]/);
    });

    it('renders 1 TND with Eastern digits and a comma decimal', () => {
      const out = formatCurrency(1000, 'ar', 'TND');
      expect(out).toContain('١,٠٠٠');
    });

    it('renders 12 millimes as ٠,٠١٢', () => {
      expect(formatCurrency(12, 'ar', 'TND')).toContain('٠,٠١٢');
    });

    it('renders 1234 TND with grouping and Eastern digits', () => {
      const out = formatCurrency(1_234_000, 'ar', 'TND');
      expect(out).toMatch(/١[\s  ]٢٣٤,٠٠٠/);
    });
  });

  it('always shows exactly 3 fraction digits regardless of locale (millime precision)', () => {
    for (const locale of ['fr', 'ar', 'en'] as const) {
      const out = formatCurrency(1000, locale, 'TND');
      const match = out.match(/\d[.,](\d+)|[٠-٩][.,]([٠-٩]+)/);
      const fraction = match?.[1] ?? match?.[2] ?? '';
      expect(fraction.length).toBe(3);
    }
  });
});

describe('formatCurrency — other currencies', () => {
  it('USD uses 2 fraction digits (cents)', () => {
    // 100 cents = $1.00
    expect(formatCurrency(100, 'en', 'USD')).toMatch(/1\.00/);
    expect(formatCurrency(100, 'en', 'USD')).toMatch(/\$/);
  });

  it('EUR uses 2 fraction digits', () => {
    expect(formatCurrency(100, 'fr', 'EUR')).toMatch(/1,00/);
  });

  it('JPY has no fraction digits (yen has no minor unit)', () => {
    // 1 yen is 1 minor unit
    const out = formatCurrency(1, 'en', 'JPY');
    expect(out).toMatch(/¥?\s?1\b/);
    expect(out).not.toMatch(/\.0+/);
  });

  it('SAR (Saudi Riyal) uses 2 fraction digits', () => {
    expect(formatCurrency(100, 'en', 'SAR')).toMatch(/1\.00/);
  });
});
