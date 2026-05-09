import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { upsertProfile } from '../repos/profile';
import { createArticle } from '../repos/articles';
import { recordMovement } from '../repos/movements';
import { addExpense } from '../repos/expenses';
import { storePhoto } from '../repos/photos';
import { quantityFor } from '../repos/quantity';
import { backupFilename, buildBackup, exportBackupBlob } from './export';
import {
  BackupIntegrityError,
  BackupParseError,
  applyBackup,
  importBackup,
  parseBackup,
  verifyIntegrity,
} from './import';
import { FORMAT_V1, type BackupV1 } from './format-v1';

async function seed(db: InventarDB): Promise<void> {
  await upsertProfile(db, { name: 'Round Trip Shop', locale: 'fr' });
  const photo = await storePhoto(db, {
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])], {
      type: 'image/jpeg',
    }),
    width: 100,
    height: 80,
    mime: 'image/jpeg',
  });
  const created = await createArticle(db, {
    name: 'Round shoe',
    photo_id: photo.id,
    category: 'sport',
    colors: ['white'],
    brand: null,
    cost_price_tnd: 40000,
    sale_price_tnd: 75000,
    notes: null,
    sizes: [
      { size: '40', initial_qty: 2 },
      { size: '41', initial_qty: 2 },
    ],
  });
  const v40 = created.variants.find((v) => v.size === '40')!;
  await recordMovement(db, { variant_id: v40.id, delta: -1, type: 'sale', note: null });
  await addExpense(db, {
    category: 'supplier_transport',
    amount_tnd: 10000,
    note: null,
    at: '2026-05-01T00:00:00.000Z',
    recurring: 'none',
  });
}

describe('backup round-trip', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('builds a v1 backup containing every table', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    expect(backup.format).toBe(FORMAT_V1);
    expect(backup.app_version).toBe('1.0.0');
    expect(backup.rows.profile).toHaveLength(1);
    expect(backup.rows.articles).toHaveLength(1);
    expect(backup.rows.variants).toHaveLength(2);
    expect(backup.rows.movements).toHaveLength(3);
    expect(backup.rows.expenses).toHaveLength(1);
    expect(backup.rows.photos).toHaveLength(1);
    expect(backup.rows.photos[0]?.blob_b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('integrity hash verifies on the freshly-built backup', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    expect(await verifyIntegrity(backup)).toBe(true);
  });

  it('integrity hash fails when a row is mutated', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    backup.rows.expenses[0]!.amount_tnd = 999_999;
    expect(await verifyIntegrity(backup)).toBe(false);
  });

  it('export → reset → replace import recovers full state', async () => {
    await seed(db);
    const before = {
      articles: await db.articles.count(),
      variants: await db.variants.count(),
      movements: await db.movements.count(),
      photos: await db.photos.count(),
      expenses: await db.expenses.count(),
    };
    const variants = await db.variants.toArray();
    const v40 = variants.find((v) => v.size === '40')!;
    const v41 = variants.find((v) => v.size === '41')!;
    const qtyBefore = {
      v40: await quantityFor(db, v40.id),
      v41: await quantityFor(db, v41.id),
    };

    const { blob } = await exportBackupBlob(db, { appVersion: '1.0.0' });
    const json = await blob.text();

    // Wipe and re-import (replace mode).
    await db.profile.clear();
    await db.articles.clear();
    await db.variants.clear();
    await db.movements.clear();
    await db.expenses.clear();
    await db.photos.clear();
    expect(await db.articles.count()).toBe(0);

    await importBackup({ data: json, mode: 'replace' }, db);

    expect(await db.articles.count()).toBe(before.articles);
    expect(await db.variants.count()).toBe(before.variants);
    expect(await db.movements.count()).toBe(before.movements);
    expect(await db.photos.count()).toBe(before.photos);
    expect(await db.expenses.count()).toBe(before.expenses);

    const photo = await db.photos.toArray();
    expect(photo[0]?.blob.type).toBe('image/jpeg');
    expect(photo[0]?.blob.size).toBe(6);

    expect(await quantityFor(db, v40.id)).toBe(qtyBefore.v40); // 1
    expect(await quantityFor(db, v41.id)).toBe(qtyBefore.v41); // 2
  });

  it('merge import keeps the row with the greater updated_at', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    // Tamper a profile row in the backup with an OLDER updated_at and a
    // different name. The current DB row should win.
    backup.rows.profile[0] = {
      ...backup.rows.profile[0]!,
      name: 'Stale Snapshot',
      updated_at: '2020-01-01T00:00:00.000Z',
    };
    // Recompute the hash so verification passes.
    const { integrityHash } = await import('./integrity');
    backup.integrity_sha256 = await integrityHash(backup.rows);

    await applyBackup(backup, { mode: 'merge' }, db);
    const profile = await db.profile.get('singleton');
    expect(profile?.name).toBe('Round Trip Shop');
  });

  it('merge import accepts newer rows from the backup', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    backup.rows.profile[0] = {
      ...backup.rows.profile[0]!,
      name: 'Renamed In Backup',
      updated_at: '2099-01-01T00:00:00.000Z',
    };
    const { integrityHash } = await import('./integrity');
    backup.integrity_sha256 = await integrityHash(backup.rows);

    await applyBackup(backup, { mode: 'merge' }, db);
    const profile = await db.profile.get('singleton');
    expect(profile?.name).toBe('Renamed In Backup');
  });

  it('merge import never duplicates movements (UUID-keyed)', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    const before = await db.movements.count();
    await applyBackup(backup, { mode: 'merge' }, db);
    expect(await db.movements.count()).toBe(before);
  });

  it('importBackup throws BackupIntegrityError when the hash is wrong', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '1.0.0' });
    const tampered: BackupV1 = { ...backup, integrity_sha256: 'deadbeef' };
    await expect(
      importBackup({ data: JSON.stringify(tampered), mode: 'replace' }, db),
    ).rejects.toBeInstanceOf(BackupIntegrityError);
  });

  it('parseBackup rejects unknown formats', () => {
    expect(() => parseBackup('not json')).toThrow(BackupParseError);
    expect(() => parseBackup({ format: 'inventar-export-v9', rows: {} })).toThrow(BackupParseError);
    expect(() =>
      parseBackup({
        format: FORMAT_V1,
        integrity_sha256: 'x',
        rows: { profile: [], articles: [] }, // missing tables
      }),
    ).toThrow(BackupParseError);
  });

  it('backupFilename uses the YYYY-MM-DD UTC date', () => {
    expect(backupFilename(new Date('2026-05-07T22:00:00.000Z'))).toBe(
      'inventar-backup-2026-05-07.json',
    );
    expect(backupFilename(new Date('2026-12-31T23:59:59.000Z'))).toBe(
      'inventar-backup-2026-12-31.json',
    );
  });
});
