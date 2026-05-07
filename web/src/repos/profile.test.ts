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
    expect(p.created_at).toBe('2026-05-07T08:00:00.000Z');
    expect(p.updated_at).toBe('2026-05-07T08:00:00.000Z');
    expect(p.last_backup_at).toBeNull();
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
