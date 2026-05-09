import { describe, expect, it } from 'vitest';
import { getMinorUnitDigits, getMinorUnitFactor, listSupportedCurrencies } from './currency';

describe('currency helpers', () => {
  it('returns CLDR minor-unit digits per currency', () => {
    expect(getMinorUnitDigits('TND')).toBe(3);
    expect(getMinorUnitDigits('USD')).toBe(2);
    expect(getMinorUnitDigits('EUR')).toBe(2);
    expect(getMinorUnitDigits('JPY')).toBe(0);
  });

  it('derives minor-unit factor from digits', () => {
    expect(getMinorUnitFactor('TND')).toBe(1000);
    expect(getMinorUnitFactor('USD')).toBe(100);
    expect(getMinorUnitFactor('JPY')).toBe(1);
  });

  it('lists currencies including the regional set we care about', () => {
    const codes = listSupportedCurrencies();
    expect(codes).toContain('TND');
    expect(codes).toContain('USD');
    expect(codes).toContain('EUR');
    expect(codes).toContain('JPY');
    // Should be a non-trivial set (Intl gives 100+; fallback list has 20).
    expect(codes.length).toBeGreaterThan(15);
  });
});
