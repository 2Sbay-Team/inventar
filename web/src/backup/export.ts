import { db as appDB, type InventarDB } from '../db/db';
import { nowISO } from '../utils/now';
import { blobToBase64 } from './base64';
import { FORMAT_V1, type BackupV1, type ExportRowsV1, type PhotoExport } from './format-v1';
import { integrityHash } from './integrity';

// SPEC §3 / DATA_MODEL §8: collect every row from every table into a single
// JSON document. Photos serialise their Blob payload to base64. The file is
// signed with an integrity hash so import can detect corruption.

export interface ExportOptions {
  appVersion: string;
  exportedAt?: string; // override only used by tests
}

export async function buildBackup(
  db: InventarDB = appDB,
  options: ExportOptions,
): Promise<BackupV1> {
  // We don't strip soft-deleted rows: a backup is a faithful snapshot of
  // the device. Restore is round-trip lossless (TESTING.md §2.6).
  const [profile, articles, variants, movements, expenses, photoRows] = await Promise.all([
    db.profile.toArray(),
    db.articles.toArray(),
    db.variants.toArray(),
    db.movements.toArray(),
    db.expenses.toArray(),
    db.photos.toArray(),
  ]);

  const photos: PhotoExport[] = await Promise.all(
    photoRows.map(async ({ blob, ...rest }) => ({
      ...rest,
      blob_b64: await blobToBase64(blob),
    })),
  );

  const rows: ExportRowsV1 = {
    profile,
    articles,
    variants,
    movements,
    expenses,
    photos,
  };

  const integrity_sha256 = await integrityHash(rows);

  return {
    format: FORMAT_V1,
    exported_at: options.exportedAt ?? nowISO(),
    app_version: options.appVersion,
    rows,
    integrity_sha256,
  };
}

// Suggested filename per SPEC §3 — date-suffixed so users can tell backups
// apart in WhatsApp / Drive without opening them.
export function backupFilename(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `inventar-backup-${yyyy}-${mm}-${dd}.json`;
}

// Returns a Blob the UI can hand to navigator.share() or an <a download>.
export async function exportBackupBlob(
  db: InventarDB = appDB,
  options: ExportOptions,
): Promise<{ blob: Blob; backup: BackupV1 }> {
  const backup = await buildBackup(db, options);
  const json = JSON.stringify(backup, null, 2);
  return {
    backup,
    blob: new Blob([json], { type: 'application/json' }),
  };
}
