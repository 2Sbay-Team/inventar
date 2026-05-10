import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { db as appDB, type InventarDB } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';
import { type Locale } from '../types';
import { DEFAULT_LOCALE, isLocale, localeToDir, SUPPORTED_LOCALES } from './locale';

import ar from './locales/ar.json';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Single source of truth for available namespaces. Adding a top-level key in
// the JSON files needs a matching entry here so TypeScript callers get
// completion.
export const NAMESPACES = [
  'common',
  'nav',
  'header',
  'onboarding',
  'search',
  'article',
  'adjust',
  'add',
  'color',
  'category',
  'dashboard',
  'expense',
  'settings',
  'list',
  'archive',
  'backup',
  'update',
  'help',
  'store_types',
  'stock_report',
  'label',
  'invoice',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

const resources = {
  fr: fr as Record<Namespace, Record<string, string>>,
  ar: ar as Record<Namespace, Record<string, string>>,
  en: en as Record<Namespace, Record<string, string>>,
};

// Apply dir/lang to <html>. Pulled out so callers (and tests) don't need to
// touch the i18next internals.
export function applyDocumentDirection(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.documentElement.dir = localeToDir(locale);
}

// Reads the persisted locale from the meta table; null if never set or stored
// as something other than a Locale string. The DB is the only durable store
// (no localStorage, ADR + storage discipline).
export async function loadPersistedLocale(db: InventarDB = appDB): Promise<Locale | null> {
  const stored = await getMeta(db, META_KEYS.locale);
  return isLocale(stored) ? stored : null;
}

export async function persistLocale(locale: Locale, db: InventarDB = appDB): Promise<void> {
  await setMeta(db, META_KEYS.locale, locale);
}

interface InitOptions {
  // Locale forced by the caller — used by the onboarding screen after the
  // user picks a language, and by tests. When unset we fall back to:
  //   1. persisted locale in meta
  //   2. browser language detector (navigator.language)
  //   3. DEFAULT_LOCALE (fr)
  initialLocale?: Locale;
  db?: InventarDB;
}

let initPromise: Promise<typeof i18next> | null = null;

export async function initI18n(options: InitOptions = {}): Promise<typeof i18next> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = options.db ?? appDB;
    const persisted = options.initialLocale ?? (await loadPersistedLocale(db));

    await i18next
      .use(LanguageDetector)
      .use(initReactI18next)
      .init({
        resources,
        fallbackLng: DEFAULT_LOCALE,
        supportedLngs: SUPPORTED_LOCALES as readonly string[] as string[],
        ns: NAMESPACES as readonly string[] as string[],
        defaultNS: 'common',
        // Persisted locale wins over the detector. We never read or write to
        // localStorage — meta table is the only durable store. The detector
        // therefore runs only when persisted is null.
        ...(persisted ? { lng: persisted } : {}),
        detection: {
          order: ['querystring', 'navigator'],
          caches: [],
          lookupQuerystring: 'lng',
        },
        interpolation: { escapeValue: false },
        returnNull: false,
      });

    // Initial dir/lang sync, then keep it in lock-step with future changes.
    applyDocumentDirection(currentLocale());
    i18next.on('languageChanged', (lng) => {
      if (!isLocale(lng)) return;
      applyDocumentDirection(lng);
      void persistLocale(lng, db);
    });

    return i18next;
  })();

  return initPromise;
}

export function currentLocale(): Locale {
  const lng = i18next.resolvedLanguage ?? i18next.language;
  return isLocale(lng) ? lng : DEFAULT_LOCALE;
}

export async function setLocale(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  await i18next.changeLanguage(locale);
}

// Reset hook — only used by tests to dispose the singleton between cases.
export function _resetI18nForTests(): void {
  initPromise = null;
}

export { i18next };
