import { useTranslation } from 'react-i18next';
import { type Locale } from '../types';
import { currentLocale, setLocale } from '../i18n/i18next';

// Thin facade over react-i18next so screens don't import i18next directly.
// Returns the current Locale (typed) plus a setter that writes through to
// the persisted-meta hook registered in initI18n's languageChanged listener.

export interface UseLocale {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
}

export function useLocale(): UseLocale {
  // useTranslation triggers a re-render when the language changes — that's
  // the only reason to call it here. We read the locale through our own
  // typed accessor so the hook return type stays narrow.
  useTranslation();
  return {
    locale: currentLocale(),
    setLocale,
  };
}
