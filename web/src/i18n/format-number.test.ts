import { describe, expect, it } from 'vitest';
import { formatNumber } from './format-number';

describe('formatNumber', () => {
  describe('en locale', () => {
    it('uses comma grouping and dot decimal', () => {
      expect(formatNumber(1234, 'en')).toBe('1,234');
      expect(formatNumber(1234567, 'en')).toBe('1,234,567');
    });

    it('formats decimals with a dot', () => {
      expect(formatNumber(1234.56, 'en')).toBe('1,234.56');
    });

    it('formats zero', () => {
      expect(formatNumber(0, 'en')).toBe('0');
    });

    it('formats negative numbers', () => {
      expect(formatNumber(-42, 'en')).toBe('-42');
    });
  });

  describe('fr locale', () => {
    it('uses non-breaking-space grouping and comma decimal', () => {
      // fr-TN groups with U+202F (NARROW NO-BREAK SPACE) in modern ICU.
      // Asserting on the digits + decimal mark, tolerant to either NBSP
      // variant the ICU build produces.
      const out = formatNumber(1234, 'fr');
      expect(out).toMatch(/^1\s234$/);
      expect(formatNumber(1234.5, 'fr')).toMatch(/^1\s234,5$/);
    });

    it('formats zero', () => {
      expect(formatNumber(0, 'fr')).toBe('0');
    });
  });

  describe('ar locale', () => {
    it('uses Eastern Arabic digits (sub-grouping numbers)', () => {
      expect(formatNumber(0, 'ar')).toBe('٠');
      expect(formatNumber(42, 'ar')).toBe('٤٢');
      expect(formatNumber(999, 'ar')).toBe('٩٩٩');
    });

    it('groups four-digit numbers per fr-TN convention (NBSP between thousand and hundreds)', () => {
      // 2026 → "2 026" in fr-TN (any NBSP variant), so AR is "٢ ٠٢٦".
      expect(formatNumber(2026, 'ar')).toMatch(/^٢\s٠٢٦$/);
    });

    it('uses Eastern digits with fr-style grouping (Tunisian convention)', () => {
      const out = formatNumber(1234, 'ar');
      expect(out).toMatch(/^١\s٢٣٤$/);
    });

    it('uses Eastern digits with comma decimal', () => {
      const out = formatNumber(12.5, 'ar');
      expect(out).toBe('١٢,٥');
    });

    it('contains no Western digits', () => {
      expect(formatNumber(123456, 'ar')).not.toMatch(/[0-9]/);
    });
  });
});
