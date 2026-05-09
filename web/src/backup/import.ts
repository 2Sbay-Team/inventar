import { db as appDB, type InventarDB } from '../db/db';
import { migrateRowsV5ToV6 } from '../db/migrate-v5-to-v6';
import { setMeta } from '../repos/meta';
import type { Photo } from '../types';
import { base64ToBlob } from './base64';
import { FORMAT_V1, type BackupV1, type PhotoExport } from './format-v1';
import { FORMAT_V2, type BackupV2, type ExportRowsV2, type PhotoExportV2 } from './format-v2';
import { integrityHash } from './integrity';

// SPEC §3 / DATA_MODEL §8: import accepts either a parsed object or a JSON
// string. We verify shape, then verify the integrity hash, then apply via
// either:
//   - replace: clear current IndexedDB tables, write imported rows
//   - merge:   per-table, keep the row with the greater updated_at
//             (movements: append both — UUID prevents duplicates)
//
// v0.3 (ADR-011 / ADR-012): the parser branches on the top-level `format`
// field. v1 files are read via format-v1.ts and run through the
// migrate-v5-to-v6 kernel in memory before the rows reach the apply path.
// v2 files are applied directly. Anything else is `BackupFormatTooNewError`,
// surfaced inline in Settings → Import Data so the user gets a clear
// "update the app" message rather than a generic parse failure.

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

export class BackupFormatTooNewError extends Error {
  constructor(format: string) {
    super(`Backup format too new — please update the app (${format})`);
    this.name = 'BackupFormatTooNewError';
  }
}

// Subset of the v2 row shape used by the apply path. The same shape comes
// out of both code paths (direct v2 read AND v1-via-migration), so the
// applier doesn't need to know which branch produced its input.
type AppliedRows = ExportRowsV2;

export interface ImportSummary {
  inserted: Record<keyof AppliedRows, number>;
  updated: Record<keyof AppliedRows, number>;
  skipped: Record<keyof AppliedRows, number>;
}

function emptySummary(): ImportSummary {
  const z = (): Record<keyof AppliedRows, number> => ({
    profile: 0,
    articles: 0,
    variants: 0,
    movements: 0,
    expenses: 0,
    photos: 0,
  });
  return { inserted: z(), updated: z(), skipped: z() };
}

export type ParsedBackup = { kind: 'v2'; backup: BackupV2 } | { kind: 'v1'; backup: BackupV1 };

export function parseBackup(input: string | unknown): ParsedBackup {
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
  const format = obj.format;
  if (format !== FORMAT_V1 && format !== FORMAT_V2) {
    if (typeof format === 'string' && format.startsWith('inventar-export-')) {
      throw new BackupFormatTooNewError(format);
    }
    throw new BackupParseError(`unknown format: ${String(format)}`);
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

  if (format === FORMAT_V2) {
    return { kind: 'v2', backup: obj as unknown as BackupV2 };
  }
  return { kind: 'v1', backup: obj as unknown as BackupV1 };
}

export async function verifyIntegrity(parsed: ParsedBackup): Promise<boolean> {
  const computed = await integrityHash(parsed.backup.rows);
  return computed === parsed.backup.integrity_sha256;
}

function rehydratePhoto(row: PhotoExport | PhotoExportV2): Photo {
  const { blob_b64, ...rest } = row;
  return { ...rest, blob: base64ToBlob(blob_b64, rest.mime) };
}

// Translates a parsed v1 backup into the same row shape applyRows
// expects. The migrate-v5-to-v6 kernel handles the variant fan-out and
// movement remapping; the resulting rows are byte-identical to what the
// Dexie version(6) upgrade callback would produce on the same input.
function transformV1ToApplied(backup: BackupV1): AppliedRows {
  const profile = backup.rows.profile[0] ?? null;
  const { rows } = migrateRowsV5ToV6({
    profile,
    articles: backup.rows.articles,
    variants: backup.rows.variants,
    movements: backup.rows.movements,
  });
  return {
    profile: backup.rows.profile,
    articles: rows.articles,
    variants: rows.variants,
    movements: rows.movements,
    expenses: backup.rows.expenses,
    photos: backup.rows.photos,
  };
}

export interface ApplyOptions {
  mode: ImportMode;
}

async function applyRows(
  rows: AppliedRows,
  parsed: ParsedBackup,
  options: ApplyOptions,
  db: InventarDB,
): Promise<ImportSummary> {
  const summary = emptySummary();
  const photos = rows.photos.map(rehydratePhoto);

  await db.transaction(
    'rw',
    [db.profile, db.articles, db.variants, db.movements, db.expenses, db.photos, db.meta],
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
        await db.profile.bulkPut(rows.profile);
        await db.articles.bulkPut(rows.articles);
        await db.variants.bulkPut(rows.variants);
        await db.movements.bulkPut(rows.movements);
        await db.expenses.bulkPut(rows.expenses);
        await db.photos.bulkPut(photos);
        summary.inserted.profile = rows.profile.length;
        summary.inserted.articles = rows.articles.length;
        summary.inserted.variants = rows.variants.length;
        summary.inserted.movements = rows.movements.length;
        summary.inserted.expenses = rows.expenses.length;
        summary.inserted.photos = photos.length;
      } else {
        await mergeWithLWW(db.profile, rows.profile, summary, 'profile');
        await mergeWithLWW(db.articles, rows.articles, summary, 'articles');
        await mergeWithLWW(db.variants, rows.variants, summary, 'variants');
        await mergeWithLWW(db.expenses, rows.expenses, summary, 'expenses');
        await mergeAppend(db.movements, rows.movements, summary, 'movements');
        await mergeAppend(db.photos, photos, summary, 'photos');
      }
    },
  );

  // After importing a v1 file we set the same migration markers the
  // Dexie upgrade callback would set, so the migration-review banner /
  // screen can show the user any movements that need verification.
  if (parsed.kind === 'v1') {
    await setMeta(db, 'migration_v6_completed_at', new Date().toISOString());
  }

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
  summary: ImportSummary,
  key: keyof AppliedRows,
): Promise<void> {
  for (const row of rows) {
    const existing = await table.get(row.id);
    if (!existing) {
      await table.put(row);
      summary.inserted[key]++;
      continue;
    }
    if (row.updated_at > existing.updated_at) {
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
  key: keyof AppliedRows,
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

// Applies a parsed backup. Used by the integration tests directly and by
// importBackup as the final step.
export async function applyBackup(
  parsed: ParsedBackup,
  options: ApplyOptions,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  const rows: AppliedRows =
    parsed.kind === 'v2' ? parsed.backup.rows : transformV1ToApplied(parsed.backup);
  return applyRows(rows, parsed, options, db);
}

export interface ImportInput {
  data: string | BackupV1 | BackupV2 | ParsedBackup;
  mode: ImportMode;
}

// Convenience entry: parse → verify → apply. Used by Settings → Import.
export async function importBackup(
  input: ImportInput,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  const parsed: ParsedBackup =
    typeof input.data === 'string' || isRawBackup(input.data)
      ? parseBackup(input.data as string | unknown)
      : (input.data as ParsedBackup);
  if (!(await verifyIntegrity(parsed))) {
    throw new BackupIntegrityError();
  }
  return applyBackup(parsed, { mode: input.mode }, db);
}

function isRawBackup(value: unknown): value is BackupV1 | BackupV2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    'format' in (value as Record<string, unknown>) &&
    'rows' in (value as Record<string, unknown>)
  );
}

// Re-exports used by callers / tests. Keeps the import surface tight.
export type { BackupV1, BackupV2 };
