import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { getProfile, markBackedUp, upsertProfile } from './profile';

describe('profile repo', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-07T08:00:00.000Z'));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('getProfile returns undefined before onboarding', async () => {
    expect(await getProfile(db)).toBeUndefined();
  });

  it('upsertProfile creates the singleton on first call', async () => {
    const p = await upsertProfile(db, { name: 'Naili Shoes', locale: 'fr' });
    expect(p.id).toBe('singleton');
    expect(p.name).toBe('Naili Shoes');
    expect(p.locale).toBe('fr');
    expect(p.logo_photo_id).toBeNull();
    expect(p.currency).toBe('TND');
    expect(p.created_at).toBe('2026-05-07T08:00:00.000Z');
    expect(p.updated_at).toBe('2026-05-07T08:00:00.000Z');
    expect(p.last_backup_at).toBeNull();
  });

  it('upsertProfile sets, preserves, and updates currency', async () => {
    let p = await upsertProfile(db, { name: 'A', locale: 'fr', currency: 'USD' });
    expect(p.currency).toBe('USD');
    // Updating without passing currency preserves the existing value.
    p = await upsertProfile(db, { name: 'B', locale: 'fr' });
    expect(p.currency).toBe('USD');
    // Switching currency updates the field but does NOT rescale stored data.
    p = await upsertProfile(db, { name: 'B', locale: 'fr', currency: 'EUR' });
    expect(p.currency).toBe('EUR');
  });

  it('upsertProfile sets, preserves, and clears logo_photo_id, hard-deleting replaced photos', async () => {
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    await db.photos.add({
      id: 'photo-1',
      blob,
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/jpeg',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    await db.photos.add({
      id: 'photo-2',
      blob,
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/jpeg',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    let p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: 'photo-1' });
    expect(p.logo_photo_id).toBe('photo-1');
    // Updating without passing logo_photo_id preserves the existing value.
    p = await upsertProfile(db, { name: 'B', locale: 'fr' });
    expect(p.logo_photo_id).toBe('photo-1');
    // Replacing the logo hard-deletes the previous Photo row.
    p = await upsertProfile(db, { name: 'B', locale: 'fr', logo_photo_id: 'photo-2' });
    expect(p.logo_photo_id).toBe('photo-2');
    expect(await db.photos.get('photo-1')).toBeUndefined();
    // Clearing the logo (null) also hard-deletes the underlying Photo row.
    p = await upsertProfile(db, { name: 'B', locale: 'fr', logo_photo_id: null });
    expect(p.logo_photo_id).toBeNull();
    expect(await db.photos.get('photo-2')).toBeUndefined();
  });

  it('upsertProfile preserves created_at on subsequent calls', async () => {
    await upsertProfile(db, { name: 'Naili', locale: 'fr' });
    vi.setSystemTime(new Date('2026-06-01T09:00:00.000Z'));
    const p = await upsertProfile(db, { name: 'Naili Shoes', locale: 'ar' });
    expect(p.name).toBe('Naili Shoes');
    expect(p.locale).toBe('ar');
    expect(p.created_at).toBe('2026-05-07T08:00:00.000Z');
    expect(p.updated_at).toBe('2026-06-01T09:00:00.000Z');
  });

  it('upsertProfile preserves last_backup_at across updates', async () => {
    await upsertProfile(db, { name: 'A', locale: 'fr' });
    await markBackedUp(db);
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    const p = await upsertProfile(db, { name: 'B', locale: 'fr' });
    expect(p.last_backup_at).toBe('2026-05-07T08:00:00.000Z');
  });

  it('markBackedUp stamps last_backup_at and bumps updated_at', async () => {
    await upsertProfile(db, { name: 'Naili', locale: 'fr' });
    vi.setSystemTime(new Date('2026-05-14T10:00:00.000Z'));
    await markBackedUp(db);
    const p = await getProfile(db);
    expect(p?.last_backup_at).toBe('2026-05-14T10:00:00.000Z');
    expect(p?.updated_at).toBe('2026-05-14T10:00:00.000Z');
  });

  it('markBackedUp throws if profile does not exist yet', async () => {
    await expect(markBackedUp(db)).rejects.toThrow(/profile/);
  });

  it('upsertProfile never inserts a second row', async () => {
    await upsertProfile(db, { name: 'A', locale: 'fr' });
    await upsertProfile(db, { name: 'B', locale: 'fr' });
    await upsertProfile(db, { name: 'C', locale: 'fr' });
    expect(await db.profile.count()).toBe(1);
  });
});
