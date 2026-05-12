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
    // v0.5.2 ADR-021: DEFAULT_STORE_TYPE moved from 'shoes' (legacy)
    // to 'fashion' (the post-merge default). Onboarding always passes
    // an explicit store_type; this default fires only for API calls
    // that omit it.
    expect(p.store_type).toBe('fashion');
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

  it("qr_center_mode auto-promotes from 'name' to 'logo' on first-logo upload", async () => {
    // Mirror the Settings "merchant uploads their first logo" flow.
    // The row starts qr_center_mode='name' (no logo → first-create
    // default). A later upsert that adds a logo without explicitly
    // touching qr_center_mode should promote it to 'logo'.
    let p = await upsertProfile(db, { name: 'A', locale: 'fr' });
    expect(p.qr_center_mode).toBe('name');
    expect(p.logo_photo_id).toBeNull();

    await db.photos.add({
      id: 'logo-photo',
      blob: new Blob(['x'], { type: 'image/png' }),
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/png',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: 'logo-photo' });
    expect(p.qr_center_mode).toBe('logo');
  });

  it("qr_center_mode preserves an explicit 'name' choice when the logo is replaced", async () => {
    // Merchant uploaded a logo, then deliberately picked 'name' in
    // the Settings picker, then later swapped the logo. The replace
    // should NOT undo the explicit choice — only first-logo-upload
    // promotes; subsequent changes preserve the merchant's pick.
    await db.photos.add({
      id: 'logo-old',
      blob: new Blob(['x'], { type: 'image/png' }),
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/png',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    await db.photos.add({
      id: 'logo-new',
      blob: new Blob(['x'], { type: 'image/png' }),
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/png',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    let p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: 'logo-old' });
    expect(p.qr_center_mode).toBe('logo'); // first-create default
    p = await upsertProfile(db, { name: 'A', locale: 'fr', qr_center_mode: 'name' });
    expect(p.qr_center_mode).toBe('name'); // explicit choice persisted
    p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: 'logo-new' });
    expect(p.qr_center_mode).toBe('name'); // preserved across logo replace
  });

  it('v0.9 Shop Identity fields default to null (and theme_mode to light) on first create', async () => {
    const p = await upsertProfile(db, { name: 'New Shop', locale: 'fr' });
    expect(p.tagline).toBeNull();
    expect(p.description).toBeNull();
    expect(p.address_street).toBeNull();
    expect(p.address_city).toBeNull();
    expect(p.address_country).toBeNull();
    expect(p.whatsapp).toBeNull();
    expect(p.email).toBeNull();
    expect(p.website).toBeNull();
    expect(p.instagram).toBeNull();
    expect(p.facebook).toBeNull();
    expect(p.tiktok).toBeNull();
    expect(p.brand_primary_color).toBeNull();
    expect(p.theme_bg_color).toBeNull();
    expect(p.logo_dominant_color).toBeNull();
    expect(p.opening_hours).toBeNull();
    expect(p.theme_mode).toBe('light');
  });

  it('upsertProfile sets, preserves, and clears each Shop Identity field', async () => {
    // One go through the set → preserve-on-omit → clear-with-null cycle
    // for the standard nullable strings. Picking three representatives
    // (one from each of identity / contact / branding) avoids 14 near-
    // identical assertion blocks while still covering the common path
    // shared by every field in the group.
    let p = await upsertProfile(db, {
      name: 'A',
      locale: 'fr',
      tagline: 'Quality fashion since 2020',
      whatsapp: '+216 98 765 432',
      brand_primary_color: '#2B4C8A',
    });
    expect(p.tagline).toBe('Quality fashion since 2020');
    expect(p.whatsapp).toBe('+216 98 765 432');
    expect(p.brand_primary_color).toBe('#2B4C8A');
    // Omitting preserves.
    p = await upsertProfile(db, { name: 'A', locale: 'fr' });
    expect(p.tagline).toBe('Quality fashion since 2020');
    expect(p.whatsapp).toBe('+216 98 765 432');
    expect(p.brand_primary_color).toBe('#2B4C8A');
    // Explicit null clears.
    p = await upsertProfile(db, {
      name: 'A',
      locale: 'fr',
      tagline: null,
      whatsapp: null,
      brand_primary_color: null,
    });
    expect(p.tagline).toBeNull();
    expect(p.whatsapp).toBeNull();
    expect(p.brand_primary_color).toBeNull();
  });

  it('upsertProfile persists opening_hours and theme_mode round-trip', async () => {
    const hours = {
      monday: { open: true, from: '08:00', to: '20:00' },
      tuesday: { open: true, from: '08:00', to: '20:00' },
      wednesday: { open: true, from: '08:00', to: '20:00' },
      thursday: { open: true, from: '08:00', to: '20:00' },
      friday: { open: true, from: '08:00', to: '22:00' },
      saturday: { open: true, from: '09:00', to: '22:00' },
      sunday: { open: false, from: '00:00', to: '00:00' },
    };
    let p = await upsertProfile(db, {
      name: 'A',
      locale: 'fr',
      opening_hours: hours,
      theme_mode: 'dark',
    });
    expect(p.opening_hours).toEqual(hours);
    expect(p.theme_mode).toBe('dark');
    // Preserved on omit.
    p = await upsertProfile(db, { name: 'A', locale: 'fr' });
    expect(p.opening_hours).toEqual(hours);
    expect(p.theme_mode).toBe('dark');
    // Cleared when null.
    p = await upsertProfile(db, { name: 'A', locale: 'fr', opening_hours: null });
    expect(p.opening_hours).toBeNull();
    // theme_mode is non-nullable — passing 'light' explicitly resets.
    p = await upsertProfile(db, { name: 'A', locale: 'fr', theme_mode: 'light' });
    expect(p.theme_mode).toBe('light');
  });

  it("qr_center_mode auto-falls-back to 'name' when the logo is removed", async () => {
    await db.photos.add({
      id: 'logo-photo',
      blob: new Blob(['x'], { type: 'image/png' }),
      width: 1,
      height: 1,
      bytes: 1,
      mime: 'image/png',
      created_at: '2026-05-07T08:00:00.000Z',
      deleted_at: null,
    });
    let p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: 'logo-photo' });
    expect(p.qr_center_mode).toBe('logo');
    p = await upsertProfile(db, { name: 'A', locale: 'fr', logo_photo_id: null });
    expect(p.qr_center_mode).toBe('name');
  });
});
