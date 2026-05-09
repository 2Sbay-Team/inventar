import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { setMeta, META_KEYS } from '../repos/meta';
import { loadPersistedLocale, persistLocale } from './i18next';

// DOM-side bootstrap (applyDocumentDirection, i18next init) is exercised by
// Playwright spec 09_locale_switch.spec.ts — that's the integration story
// where it actually has to work. Unit tests here cover only the parts that
// are pure / IndexedDB-driven, since the project's vitest env is `node`.

describe('persisted locale (meta table)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('returns null when meta has no locale', async () => {
    expect(await loadPersistedLocale(db)).toBeNull();
  });

  it('round-trips a persisted locale', async () => {
    await persistLocale('ar', db);
    expect(await loadPersistedLocale(db)).toBe('ar');
    await persistLocale('en', db);
    expect(await loadPersistedLocale(db)).toBe('en');
  });

  it('rejects garbage stored under the locale key', async () => {
    await setMeta(db, META_KEYS.locale, 'klingon');
    expect(await loadPersistedLocale(db)).toBeNull();
    await setMeta(db, META_KEYS.locale, 42);
    expect(await loadPersistedLocale(db)).toBeNull();
  });
});
