import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';

// v0.6.5 — the v13→v14 Dexie upgrade backfills qr_center_mode on
// every profile row. Rows with a logo land on 'logo'; everyone
// else gets 'name'. Idempotent — re-running over an already-set
// row (e.g. a v14-aware app writing the field, then the upgrade
// being re-applied via a backup import that re-opens the DB
// against the kernel) leaves the value alone.
//
// The production upgrade lives inside db.ts's version().upgrade()
// chain, opaque from outside. This test mirrors the same upgrade
// rule inline so the migration contract is pinned without booting
// the full InventarDB class.

const DB_NAME = 'migrate-v13-v14-test';

interface ProfileRow {
  id: string;
  name: string;
  logo_photo_id?: string | null;
  qr_center_mode?: 'logo' | 'name';
}

function attachV14Upgrade(db: Dexie): void {
  db.version(13).stores({ profile: 'id' });
  db.version(14)
    .stores({ profile: 'id' })
    .upgrade(async (tx) => {
      await tx
        .table('profile')
        .toCollection()
        .modify((p: { qr_center_mode?: 'logo' | 'name'; logo_photo_id?: string | null }) => {
          if (p.qr_center_mode === 'logo' || p.qr_center_mode === 'name') return;
          p.qr_center_mode = p.logo_photo_id ? 'logo' : 'name';
        });
    });
}

async function seedAtV13(row: ProfileRow): Promise<void> {
  const db = new Dexie(DB_NAME);
  db.version(13).stores({ profile: 'id' });
  await db.open();
  await db.table('profile').add(row);
  db.close();
}

async function openAtV14(): Promise<Dexie> {
  const db = new Dexie(DB_NAME);
  attachV14Upgrade(db);
  await db.open();
  return db;
}

describe('v13 → v14 upgrade — qr_center_mode backfill', () => {
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
  });
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it("seeds 'logo' when the profile has a logo_photo_id", async () => {
    await seedAtV13({
      id: 'singleton',
      name: 'Logo Shop',
      logo_photo_id: 'photo-uuid-1',
    });
    const db = await openAtV14();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.qr_center_mode).toBe('logo');
    expect(after.logo_photo_id).toBe('photo-uuid-1');
  });

  it("seeds 'name' when no logo is set", async () => {
    await seedAtV13({
      id: 'singleton',
      name: 'No Logo Shop',
      logo_photo_id: null,
    });
    const db = await openAtV14();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.qr_center_mode).toBe('name');
  });

  it("seeds 'name' when logo_photo_id is missing (undefined) — covers v6 / v7 profile shapes", async () => {
    await seedAtV13({ id: 'singleton', name: 'Legacy Shop' });
    const db = await openAtV14();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.qr_center_mode).toBe('name');
  });

  it("idempotent: an already-'logo' row stays 'logo' on a re-run", async () => {
    await seedAtV13({
      id: 'singleton',
      name: 'Already Set',
      logo_photo_id: 'photo-uuid-2',
      qr_center_mode: 'logo',
    });
    const db = await openAtV14();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.qr_center_mode).toBe('logo');
  });

  it("idempotent: an already-'name' row stays 'name' even if a logo exists (merchant picked 'name' explicitly)", async () => {
    // The merchant intentionally chose 'name' despite having a logo
    // uploaded — the upgrade must not overwrite that pick on re-run.
    await seedAtV13({
      id: 'singleton',
      name: 'Name By Choice',
      logo_photo_id: 'photo-uuid-3',
      qr_center_mode: 'name',
    });
    const db = await openAtV14();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.qr_center_mode).toBe('name');
  });
});
