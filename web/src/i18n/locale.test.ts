import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, localeToDir, pickInitialLocale } from './locale';

describe('isLocale', () => {
  it('accepts each supported locale', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('en')).toBe(true);
  });
  it('rejects unsupported strings and non-strings', () => {
    expect(isLocale('de')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe('pickInitialLocale', () => {
  it('matches a bare supported tag', () => {
    expect(pickInitialLocale('fr')).toBe('fr');
    expect(pickInitialLocale('ar')).toBe('ar');
    expect(pickInitialLocale('en')).toBe('en');
  });
  it('matches the primary subtag of a regional tag', () => {
    expect(pickInitialLocale('ar-TN')).toBe('ar');
    expect(pickInitialLocale('en-GB')).toBe('en');
    expect(pickInitialLocale('fr_CH')).toBe('fr');
  });
  it('is case-insensitive', () => {
    expect(pickInitialLocale('AR')).toBe('ar');
    expect(pickInitialLocale('Fr-Fr')).toBe('fr');
  });
  it('falls back to FR for unsupported tags', () => {
    expect(pickInitialLocale('de-DE')).toBe(DEFAULT_LOCALE);
    expect(pickInitialLocale('ja')).toBe(DEFAULT_LOCALE);
  });
  it('falls back to FR for missing input', () => {
    expect(pickInitialLocale(null)).toBe(DEFAULT_LOCALE);
    expect(pickInitialLocale(undefined)).toBe(DEFAULT_LOCALE);
    expect(pickInitialLocale('')).toBe(DEFAULT_LOCALE);
  });
});

describe('localeToDir', () => {
  it('maps ar to rtl and everything else to ltr', () => {
    expect(localeToDir('ar')).toBe('rtl');
    expect(localeToDir('fr')).toBe('ltr');
    expect(localeToDir('en')).toBe('ltr');
  });
});
