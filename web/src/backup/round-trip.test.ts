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
  BackupFormatTooNewError,
  BackupIntegrityError,
  BackupParseError,
  applyBackup,
  importBackup,
  parseBackup,
  verifyIntegrity,
} from './import';
import { FORMAT_V2, type BackupV2 } from './format-v2';
import { FORMAT_V1, type BackupV1 } from './format-v1';
import { integrityHash } from './integrity';

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
  await recordMovement(db, {
    variant_id: v40.id,
    delta: -1,
    type: 'sale',
    note: null,
    location: 'back',
  });
  await addExpense(db, {
    category: 'supplier_transport',
    amount_tnd: 10000,
    note: null,
    at: '2026-05-01T00:00:00.000Z',
    recurring: 'none',
  });
}

describe('backup round-trip (v2)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('builds a v2 backup containing every table', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    expect(backup.format).toBe(FORMAT_V2);
    expect(backup.app_version).toBe('0.3.0');
    expect(backup.rows.profile).toHaveLength(1);
    expect(backup.rows.articles).toHaveLength(1);
    expect(backup.rows.variants).toHaveLength(2);
    expect(backup.rows.movements).toHaveLength(3);
    expect(backup.rows.expenses).toHaveLength(1);
    expect(backup.rows.photos).toHaveLength(1);
    expect(backup.rows.photos[0]?.blob_b64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // ADR-012: v2 movements carry location.
    expect(backup.rows.movements.every((m) => m.location !== undefined)).toBe(true);
    // ADR-011: v2 variants carry colour.
    expect(backup.rows.variants.every((v) => 'color' in v)).toBe(true);
  });

  it('integrity hash verifies on the freshly-built backup', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    expect(await verifyIntegrity({ kind: 'v2', backup })).toBe(true);
  });

  it('integrity hash fails when a row is mutated', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    backup.rows.expenses[0]!.amount_tnd = 999_999;
    expect(await verifyIntegrity({ kind: 'v2', backup })).toBe(false);
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

    const { blob } = await exportBackupBlob(db, { appVersion: '0.3.0' });
    const json = await blob.text();

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
    // v0.5.2.2: storage shape is now `Blob | Uint8Array`. Imports
    // round-trip through base64 so the imported row is a fresh Blob,
    // but be defensive in case future migrations change the path.
    const stored = photo[0]?.blob;
    const sizeBytes = stored instanceof Blob ? stored.size : (stored?.byteLength ?? -1);
    const mimeStr = stored instanceof Blob ? stored.type : (photo[0]?.mime ?? '');
    expect(mimeStr).toBe('image/jpeg');
    expect(sizeBytes).toBe(6);

    expect(await quantityFor(db, v40.id)).toBe(qtyBefore.v40);
    expect(await quantityFor(db, v41.id)).toBe(qtyBefore.v41);
  });

  it('merge import keeps the row with the greater updated_at', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    backup.rows.profile[0] = {
      ...backup.rows.profile[0]!,
      name: 'Stale Snapshot',
      updated_at: '2020-01-01T00:00:00.000Z',
    };
    backup.integrity_sha256 = await integrityHash(backup.rows);

    await applyBackup({ kind: 'v2', backup }, { mode: 'merge' }, db);
    const profile = await db.profile.get('singleton');
    expect(profile?.name).toBe('Round Trip Shop');
  });

  it('merge import accepts newer rows from the backup', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    backup.rows.profile[0] = {
      ...backup.rows.profile[0]!,
      name: 'Renamed In Backup',
      updated_at: '2099-01-01T00:00:00.000Z',
    };
    backup.integrity_sha256 = await integrityHash(backup.rows);

    await applyBackup({ kind: 'v2', backup }, { mode: 'merge' }, db);
    const profile = await db.profile.get('singleton');
    expect(profile?.name).toBe('Renamed In Backup');
  });

  it('merge import never duplicates movements (UUID-keyed)', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    const before = await db.movements.count();
    await applyBackup({ kind: 'v2', backup }, { mode: 'merge' }, db);
    expect(await db.movements.count()).toBe(before);
  });

  it('importBackup throws BackupIntegrityError when the hash is wrong', async () => {
    await seed(db);
    const backup = await buildBackup(db, { appVersion: '0.3.0' });
    const tampered: BackupV2 = { ...backup, integrity_sha256: 'deadbeef' };
    await expect(
      importBackup({ data: JSON.stringify(tampered), mode: 'replace' }, db),
    ).rejects.toBeInstanceOf(BackupIntegrityError);
  });

  it('parseBackup classifies inputs and rejects malformed shapes', () => {
    expect(() => parseBackup('not json')).toThrow(BackupParseError);
    expect(() =>
      parseBackup({
        format: FORMAT_V2,
        integrity_sha256: 'x',
        rows: { profile: [], articles: [] }, // missing tables
      }),
    ).toThrow(BackupParseError);
    expect(() => parseBackup({ format: 'something-else' })).toThrow(BackupParseError);
  });

  it('parseBackup throws BackupFormatTooNewError for unknown inventar-export-vN versions', () => {
    expect(() =>
      parseBackup({
        format: 'inventar-export-v9',
        integrity_sha256: 'x',
        rows: { profile: [], articles: [], variants: [], movements: [], expenses: [], photos: [] },
      }),
    ).toThrow(BackupFormatTooNewError);
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

// ---------- v1 → in-memory migration → apply ----------
//
// Hand-crafted v1-shape file. Same schema the live app emitted before
// ADR-011/012 landed. The reader runs the migrate-v5-to-v6 kernel before
// the rows reach the apply path; the test asserts that the final DB
// state is the same shape as if the rows had been written fresh in v6.

function buildV1Fixture(): BackupV1 {
  const profile = {
    id: 'singleton' as const,
    name: 'Legacy Shop',
    locale: 'fr' as const,
    logo_photo_id: null,
    currency: 'TND',
    store_type: 'shoes' as const,
    created_at: '2026-04-01T00:00:00.000Z',
    updated_at: '2026-04-01T00:00:00.000Z',
    last_backup_at: null,
  };
  const articles = [
    {
      id: 'a-1',
      internal_code: 'SH-0001',
      name: 'Air Max',
      photo_id: null,
      category: 'sport',
      colors: ['black', 'yellow'],
      brand: 'Nike',
      cost_price_tnd: 40000,
      sale_price_tnd: 75000,
      notes: null,
      search_blob: 'air max sh-0001 nike black yellow sport',
      updated_at: '2026-04-01T00:00:00.000Z',
      archived_at: null,
      deleted_at: null,
    },
  ];
  const variants = [
    {
      id: 'v-40',
      article_id: 'a-1',
      size: '40',
      hidden: false,
      updated_at: '2026-04-01T00:00:00.000Z',
      deleted_at: null,
    },
  ];
  const movements = [
    {
      id: 'm-1',
      variant_id: 'v-40',
      delta: 5,
      type: 'purchase' as const,
      note: null,
      unit_price_tnd: null,
      created_at: '2026-04-02T00:00:00.000Z',
      deleted_at: null,
    },
  ];
  const rows = {
    profile: [profile],
    articles,
    variants,
    movements,
    expenses: [],
    photos: [],
  };
  return {
    format: FORMAT_V1,
    exported_at: '2026-04-03T00:00:00.000Z',
    app_version: '1.0.0',
    rows,
    integrity_sha256: 'placeholder',
  };
}

describe('backup round-trip (v1 read path with in-memory migration)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('imports a v1 file by running the v5→v6 transform in memory before write', async () => {
    const fixture = buildV1Fixture();
    fixture.integrity_sha256 = await integrityHash(fixture.rows);

    const summary = await importBackup({ data: JSON.stringify(fixture), mode: 'replace' }, db);

    // Article passed through (1 row).
    expect(summary.inserted.articles).toBe(1);
    // Variant fan-out: 1 legacy variant × 2 colours = 2 new variants
    // PLUS the tombstoned legacy row → 3 rows on disk.
    expect(await db.variants.count()).toBe(3);
    const alive = await db.variants.filter((v) => v.deleted_at === null).toArray();
    expect(alive.length).toBe(2);
    expect(new Set(alive.map((v) => v.color))).toEqual(new Set(['black', 'yellow']));

    // The original movement is remapped to one of the new variants and
    // gets the (migrated v5→v6 …) marker because the colour assignment is
    // ambiguous (≥2 colours).
    expect(await db.movements.count()).toBe(1);
    const m = (await db.movements.toArray())[0]!;
    expect(m.location).toBe('back');
    expect(m.note).toMatch(/migrated v5→v6/);
  });

  it('rejects a v1 file whose integrity hash is wrong', async () => {
    const fixture = buildV1Fixture();
    fixture.integrity_sha256 = 'deadbeef';
    await expect(
      importBackup({ data: JSON.stringify(fixture), mode: 'replace' }, db),
    ).rejects.toBeInstanceOf(BackupIntegrityError);
  });
});
