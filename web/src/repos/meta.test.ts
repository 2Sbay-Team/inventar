import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { deleteMeta, getMeta, META_KEYS, setMeta } from './meta';

describe('meta repo', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('returns undefined for missing keys', async () => {
    expect(await getMeta(db, 'never-set')).toBeUndefined();
  });

  it('round-trips primitive values', async () => {
    await setMeta(db, META_KEYS.locale, 'ar');
    expect(await getMeta<string>(db, META_KEYS.locale)).toBe('ar');
  });

  it('round-trips structured values', async () => {
    const value = { last: ['white 42', 'brown 40'], v: 1 };
    await setMeta(db, META_KEYS.recent_searches, value);
    expect(await getMeta(db, META_KEYS.recent_searches)).toEqual(value);
  });

  it('overwrites on repeat puts', async () => {
    await setMeta(db, META_KEYS.locale, 'fr');
    await setMeta(db, META_KEYS.locale, 'en');
    expect(await getMeta<string>(db, META_KEYS.locale)).toBe('en');
  });

  it('deletes a key', async () => {
    await setMeta(db, META_KEYS.locale, 'fr');
    await deleteMeta(db, META_KEYS.locale);
    expect(await getMeta(db, META_KEYS.locale)).toBeUndefined();
  });
});
