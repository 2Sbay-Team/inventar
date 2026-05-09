import { db as appDB, type InventarDB } from '../db/db';
import type { Photo } from '../types';
import { base64ToBlob } from './base64';
import { FORMAT_V1, type BackupV1, type ExportRowsV1, type PhotoExport } from './format-v1';
import { integrityHash } from './integrity';

// SPEC §3 / DATA_MODEL §8: import accepts either a parsed object or a JSON
// string. We verify shape, then verify the integrity hash, then apply via
// either:
//   - replace: clear current IndexedDB tables, write imported rows
//   - merge:   per-table, keep the row with the greater updated_at
//             (movements: append both — UUID prevents duplicates)

export type ImportMode = 'replace' | 'merge';

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export class BackupIntegrityError extends Error {
  constructor() {
    super('integrity hash mismatch');
    this.name = 'BackupIntegrityError';
  }
}

export interface ImportSummary {
  inserted: Record<keyof ExportRowsV1, number>;
  updated: Record<keyof ExportRowsV1, number>;
  skipped: Record<keyof ExportRowsV1, number>;
}

function emptySummary(): ImportSummary {
  const z = (): Record<keyof ExportRowsV1, number> => ({
    profile: 0,
    articles: 0,
    variants: 0,
    movements: 0,
    expenses: 0,
    photos: 0,
  });
  return { inserted: z(), updated: z(), skipped: z() };
}

export function parseBackup(input: string | unknown): BackupV1 {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new BackupParseError(`invalid JSON: ${(err as Error).message}`);
    }
  } else {
    raw = input;
  }

  if (!raw || typeof raw !== 'object') {
    throw new BackupParseError('not an object');
  }
  const obj = raw as Record<string, unknown>;
  if (obj.format !== FORMAT_V1) {
    throw new BackupParseError(`unknown format: ${String(obj.format)}`);
  }
  if (typeof obj.integrity_sha256 !== 'string') {
    throw new BackupParseError('missing integrity_sha256');
  }
  if (!obj.rows || typeof obj.rows !== 'object') {
    throw new BackupParseError('missing rows');
  }
  const rows = obj.rows as Record<string, unknown>;
  for (const k of ['profile', 'articles', 'variants', 'movements', 'expenses', 'photos']) {
    if (!Array.isArray(rows[k])) {
      throw new BackupParseError(`rows.${k} must be an array`);
    }
  }

  return obj as unknown as BackupV1;
}

export async function verifyIntegrity(backup: BackupV1): Promise<boolean> {
  const computed = await integrityHash(backup.rows);
  return computed === backup.integrity_sha256;
}

function rehydratePhoto(row: PhotoExport): Photo {
  const { blob_b64, ...rest } = row;
  return { ...rest, blob: base64ToBlob(blob_b64, rest.mime) };
}

interface ApplyOptions {
  mode: ImportMode;
}

export async function applyBackup(
  backup: BackupV1,
  options: ApplyOptions,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  const summary = emptySummary();
  const photos = backup.rows.photos.map(rehydratePhoto);

  await db.transaction(
    'rw',
    [db.profile, db.articles, db.variants, db.movements, db.expenses, db.photos],
    async () => {
      if (options.mode === 'replace') {
        await Promise.all([
          db.profile.clear(),
          db.articles.clear(),
          db.variants.clear(),
          db.movements.clear(),
          db.expenses.clear(),
          db.photos.clear(),
        ]);
        await db.profile.bulkPut(backup.rows.profile);
        await db.articles.bulkPut(backup.rows.articles);
        await db.variants.bulkPut(backup.rows.variants);
        await db.movements.bulkPut(backup.rows.movements);
        await db.expenses.bulkPut(backup.rows.expenses);
        await db.photos.bulkPut(photos);
        summary.inserted.profile = backup.rows.profile.length;
        summary.inserted.articles = backup.rows.articles.length;
        summary.inserted.variants = backup.rows.variants.length;
        summary.inserted.movements = backup.rows.movements.length;
        summary.inserted.expenses = backup.rows.expenses.length;
        summary.inserted.photos = photos.length;
        return;
      }

      // Merge mode: LWW per row by updated_at (or created_at for movements,
      // which never edit). Movements append on UUID collision-free.
      await mergeWithLWW(db.profile, backup.rows.profile, 'updated_at', summary, 'profile');
      await mergeWithLWW(db.articles, backup.rows.articles, 'updated_at', summary, 'articles');
      await mergeWithLWW(db.variants, backup.rows.variants, 'updated_at', summary, 'variants');
      await mergeWithLWW(db.expenses, backup.rows.expenses, 'updated_at', summary, 'expenses');
      // Movements never edit (created_at is set once); upsert by id is safe
      // — UUIDs guarantee no duplicate inserts. We treat collisions as kept.
      await mergeAppend(db.movements, backup.rows.movements, summary, 'movements');
      await mergeAppend(db.photos, photos, summary, 'photos');
    },
  );

  return summary;
}

interface MergeableRow {
  id: string;
}
interface RowWithUpdatedAt extends MergeableRow {
  updated_at: string;
}

async function mergeWithLWW<R extends RowWithUpdatedAt>(
  table: { get(id: string): Promise<R | undefined>; put(row: R): Promise<unknown> },
  rows: R[],
  field: 'updated_at',
  summary: ImportSummary,
  key: keyof ExportRowsV1,
): Promise<void> {
  for (const row of rows) {
    const existing = await table.get(row.id);
    if (!existing) {
      await table.put(row);
      summary.inserted[key]++;
      continue;
    }
    if (row[field] > existing[field]) {
      await table.put(row);
      summary.updated[key]++;
    } else {
      summary.skipped[key]++;
    }
  }
}

async function mergeAppend<R extends MergeableRow>(
  table: { get(id: string): Promise<R | undefined>; put(row: R): Promise<unknown> },
  rows: R[],
  summary: ImportSummary,
  key: keyof ExportRowsV1,
): Promise<void> {
  for (const row of rows) {
    const existing = await table.get(row.id);
    if (existing) {
      summary.skipped[key]++;
      continue;
    }
    await table.put(row);
    summary.inserted[key]++;
  }
}

export interface ImportInput {
  data: string | BackupV1;
  mode: ImportMode;
}

// Convenience entry: parse → verify → apply. Used by Settings → Import.
export async function importBackup(
  input: ImportInput,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  const backup = parseBackup(input.data);
  if (!(await verifyIntegrity(backup))) {
    throw new BackupIntegrityError();
  }
  return applyBackup(backup, { mode: input.mode }, db);
}

// Re-exports used by callers / tests. Keeps the import surface tight.
export type { BackupV1 };
