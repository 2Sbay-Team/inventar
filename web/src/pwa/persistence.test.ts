import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { ensurePersistence, persistenceRequested } from './persistence';

describe('ensurePersistence', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.unstubAllGlobals();
  });

  it('returns supported=false when navigator.storage is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const result = await ensurePersistence(db);
    expect(result.supported).toBe(false);
    expect(result.granted).toBe(false);
    expect(await persistenceRequested(db)).toBe(false);
  });

  it('returns granted=true and records the call when the API grants persistence', async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persist, persisted } });
    const result = await ensurePersistence(db);
    expect(result).toEqual({ granted: true, supported: true });
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await persistenceRequested(db)).toBe(true);
  });

  it('skips the call when storage is already persistent', async () => {
    const persist = vi.fn(async () => false);
    const persisted = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persist, persisted } });
    const result = await ensurePersistence(db);
    expect(result).toEqual({ granted: true, supported: true });
    expect(persist).not.toHaveBeenCalled();
    expect(await persistenceRequested(db)).toBe(true);
  });

  it('records the request even when the browser denies persistence', async () => {
    const persist = vi.fn(async () => false);
    const persisted = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persist, persisted } });
    const result = await ensurePersistence(db);
    expect(result).toEqual({ granted: false, supported: true });
    expect(await persistenceRequested(db)).toBe(true);
  });

  it('survives a navigator.storage.persist() rejection', async () => {
    const persist = vi.fn(async () => {
      throw new Error('boom');
    });
    const persisted = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persist, persisted } });
    const result = await ensurePersistence(db);
    expect(result).toEqual({ granted: false, supported: true });
    expect(await persistenceRequested(db)).toBe(true);
  });
});
