import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { normaliseBackLabel, normaliseFrontLabel } from '../config/location-options';

// v0.6.3 ADR-029 amendment — the v12→v13 Dexie upgrade rewrites
// location_front_label / location_back_label from per-locale display
// strings ("Shop floor" / "Magasin" / "المحل") to locale-neutral keys
// ("shop_floor"). Merchant-typed customs get a `custom:` sentinel.
//
// Tests below mirror the production upgrade callback inline (Dexie's
// version() chain is opaque from outside db.ts) and exercise the same
// normaliseFrontLabel / normaliseBackLabel helpers the real upgrade
// imports. That keeps the test focused on the migration contract
// without booting the full InventarDB class.

const DB_NAME = 'migrate-v12-v13-test';

interface ProfileRow {
  id: string;
  name: string;
  location_floor_label?: string;
  location_back_label?: string;
}

function attachV13Upgrade(db: Dexie): void {
  db.version(12).stores({ profile: 'id' });
  db.version(13)
    .stores({ profile: 'id' })
    .upgrade(async (tx) => {
      await tx
        .table('profile')
        .toCollection()
        .modify((p: { location_floor_label?: string; location_back_label?: string }) => {
          if (typeof p.location_floor_label === 'string' && p.location_floor_label !== '') {
            p.location_floor_label = normaliseFrontLabel(p.location_floor_label);
          }
          if (typeof p.location_back_label === 'string' && p.location_back_label !== '') {
            p.location_back_label = normaliseBackLabel(p.location_back_label);
          }
        });
    });
}

async function seedAtV12(row: ProfileRow): Promise<void> {
  const db = new Dexie(DB_NAME);
  db.version(12).stores({ profile: 'id' });
  await db.open();
  await db.table('profile').add(row);
  db.close();
}

async function openAtV13(): Promise<Dexie> {
  const db = new Dexie(DB_NAME);
  attachV13Upgrade(db);
  await db.open();
  return db;
}

describe('v12 → v13 upgrade — location label key normalisation', () => {
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
  });
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('rewrites legacy English display strings to their canonical keys', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'EN Shop',
      location_floor_label: 'Shop floor',
      location_back_label: 'Stockroom',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('shop_floor');
    expect(after.location_back_label).toBe('stockroom');
  });

  it('rewrites legacy French display strings to their canonical keys', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'FR Shop',
      location_floor_label: 'Boutique',
      location_back_label: 'Réserve',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('display');
    expect(after.location_back_label).toBe('stockroom');
  });

  it('rewrites legacy Arabic display strings — covers the user-reported "الواجهة" case', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'AR Shop',
      location_floor_label: 'الواجهة',
      location_back_label: 'المستودع',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    // الواجهة (AR display for the `display` front key) → 'display'.
    expect(after.location_floor_label).toBe('display');
    // المستودع (AR display for the `back` back key) → 'back'.
    expect(after.location_back_label).toBe('back');
  });

  it('wraps unknown custom values with the `custom:` prefix', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'Custom Shop',
      location_floor_label: 'TTT',
      location_back_label: 'BACK TT',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('custom:TTT');
    expect(after.location_back_label).toBe('custom:BACK TT');
  });

  it('zone-aware: "Back" typed in the FRONT field is preserved as custom, not coerced to the back key', async () => {
    // Cross-zone collision check. The display string "Back" exists
    // as the EN display for the `back` BACK-zone key. If reverse
    // lookup were zone-agnostic, this would silently flip the value
    // to a BackKey on a FrontKey column and the resolver would later
    // fail to find it in FRONT_OPTIONS_BY_KEY.
    await seedAtV12({
      id: 'singleton',
      name: 'Zone Shop',
      location_floor_label: 'Back',
      location_back_label: 'Front',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('custom:Back');
    expect(after.location_back_label).toBe('custom:Front');
  });

  it('idempotent: already-keyed values are not double-wrapped', async () => {
    // Simulates a v13-aware app writing canonical keys, then the same
    // upgrade running again (defence-in-depth — Dexie won't actually
    // re-run an applied upgrade, but a backup-import path could feed
    // an already-keyed value through normaliseFrontLabel directly).
    await seedAtV12({
      id: 'singleton',
      name: 'Already Migrated',
      location_floor_label: 'shop_floor',
      location_back_label: 'stockroom',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('shop_floor');
    expect(after.location_back_label).toBe('stockroom');
  });

  it('idempotent: already-prefixed custom values stay single-prefixed', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'Already Custom',
      location_floor_label: 'custom:Tiroir A',
      location_back_label: 'custom:Cave',
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBe('custom:Tiroir A');
    expect(after.location_back_label).toBe('custom:Cave');
  });

  it('skips empty / missing fields without coercing them to "custom:"', async () => {
    await seedAtV12({
      id: 'singleton',
      name: 'No Labels',
      // Both fields omitted — useLocationLabels falls back to the
      // (vertical, locale) defaults at render time.
    });

    const db = await openAtV13();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();

    expect(after.location_floor_label).toBeUndefined();
    expect(after.location_back_label).toBeUndefined();
  });
});
