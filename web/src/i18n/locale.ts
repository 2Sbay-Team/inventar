import { type Locale } from '../types';

// Pure helpers around the Locale union. No DOM, no i18next, no DB — those
// live in `i18next.ts` and `applyDocumentDirection.ts` so the logic here
// stays trivially unit-testable.

export const SUPPORTED_LOCALES: readonly Locale[] = ['fr', 'ar', 'en'] as const;
export const DEFAULT_LOCALE: Locale = 'fr';

export function isLocale(x: unknown): x is Locale {
  return typeof x === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(x);
}

// SPEC §2.1: the language picker defaults to the device locale if it matches
// one of fr/ar/en, otherwise FR. Accepts any BCP-47 tag and looks at its
// primary subtag — so "ar-TN", "ar_EG", "AR" all resolve to "ar".
export function pickInitialLocale(detected: string | null | undefined): Locale {
  if (!detected) return DEFAULT_LOCALE;
  const primary = detected.toLowerCase().split(/[-_]/)[0];
  if (primary && isLocale(primary)) return primary;
  return DEFAULT_LOCALE;
}

// ADR-006: Arabic is the only RTL locale we ship.
export function localeToDir(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
