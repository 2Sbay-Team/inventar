import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { getPhoto, hardDeletePhoto, softDeletePhoto, storePhoto } from './photos';

function makeBlob(): Blob {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  return new Blob([bytes], { type: 'image/jpeg' });
}

describe('photos repo', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-07T12:00:00.000Z'));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('storePhoto persists blob + metadata + timestamps', async () => {
    const blob = makeBlob();
    const p = await storePhoto(db, { blob, width: 1280, height: 720, mime: 'image/jpeg' });
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.bytes).toBe(blob.size);
    expect(p.created_at).toBe('2026-05-07T12:00:00.000Z');
    expect(p.deleted_at).toBeNull();
    const round = await db.photos.get(p.id);
    expect(round?.bytes).toBe(blob.size);
  });

  it('getPhoto returns the row when alive', async () => {
    const p = await storePhoto(db, { blob: makeBlob(), width: 10, height: 10, mime: 'image/jpeg' });
    expect((await getPhoto(db, p.id))?.id).toBe(p.id);
  });

  it('getPhoto returns undefined for missing ids', async () => {
    expect(await getPhoto(db, 'no-such-id')).toBeUndefined();
  });

  it('getPhoto hides soft-deleted photos from callers', async () => {
    const p = await storePhoto(db, { blob: makeBlob(), width: 10, height: 10, mime: 'image/jpeg' });
    await softDeletePhoto(db, p.id);
    expect(await getPhoto(db, p.id)).toBeUndefined();
    // The row is still on disk — soft, not hard.
    expect(await db.photos.get(p.id)).toBeDefined();
  });

  it('hardDeletePhoto removes the row', async () => {
    const p = await storePhoto(db, { blob: makeBlob(), width: 10, height: 10, mime: 'image/jpeg' });
    await hardDeletePhoto(db, p.id);
    expect(await db.photos.get(p.id)).toBeUndefined();
  });
});
