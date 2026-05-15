import { db as appDB, type InventarDB } from '../db/db';
import { nowISO } from '../utils/now';
import { photoToBlob } from '../repos/photos';
import { getMeta, META_KEYS } from '../repos/meta';
import { blobToBase64 } from './base64';
import { FORMAT_V3, type BackupV3, type ExportRowsV3, type PhotoExportV3 } from './format-v3';
import { integrityHash } from './integrity';

// SPEC §3 / DATA_MODEL §8: collect every row from every table into a single
// JSON document. Photos serialise their Blob payload to base64. The file is
// signed with an integrity hash so import can detect corruption.
//
// v0.5.2.5: emits inventar-export-v3 (adds lots + invoices, plus the
// invoice-counter meta snapshot). v2-era and v1-era apps reading this
// file raise BackupFormatTooNewError on parse (see backup/import.ts);
// the import side here still accepts both v1 and v2 going backward.

export interface ExportOptions {
  appVersion: string;
  exportedAt?: string; // override only used by tests
}

export async function buildBackup(
  db: InventarDB = appDB,
  options: ExportOptions,
): Promise<BackupV3> {
  // We don't strip soft-deleted rows: a backup is a faithful snapshot of
  // the device. Restore is round-trip lossless (TESTING.md §2.6).
  const [profile, articles, variants, movements, expenses, customers, photoRows, lots, invoices] =
    await Promise.all([
      db.profile.toArray(),
      db.articles.toArray(),
      db.variants.toArray(),
      db.movements.toArray(),
      db.expenses.toArray(),
      db.customers.toArray(),
      db.photos.toArray(),
      db.lots.toArray(),
      db.invoices.toArray(),
    ]);

  const photos: PhotoExportV3[] = await Promise.all(
    photoRows.map(async (row) => {
      const { blob: _blob, ...rest } = row;
      return {
        ...rest,
        // v0.5.2.2: photo.blob may be Uint8Array (Webkit-safe storage
        // shape) or Blob (legacy rows). photoToBlob normalises.
        blob_b64: await blobToBase64(photoToBlob(row)),
      };
    }),
  );

  const rows: ExportRowsV3 = {
    profile,
    articles,
    variants,
    movements,
    expenses,
    customers,
    photos,
    lots,
    invoices,
  };

  // v0.5.2.5 ADR-024: persist the per-year invoice counter so restored
  // installs keep numbering monotonic. We accept any shape from meta but
  // store back as the documented {[year]: number} map.
  const counterRaw = await getMeta<unknown>(db, META_KEYS.invoice_counter);
  const invoice_counter: Record<string, number> = {};
  if (counterRaw && typeof counterRaw === 'object') {
    for (const [k, v] of Object.entries(counterRaw as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) {
        invoice_counter[k] = v;
      }
    }
  }

  const integrity_sha256 = await integrityHash(rows);

  return {
    format: FORMAT_V3,
    exported_at: options.exportedAt ?? nowISO(),
    app_version: options.appVersion,
    rows,
    invoice_counter,
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
): Promise<{ blob: Blob; backup: BackupV3 }> {
  const backup = await buildBackup(db, options);
  const json = JSON.stringify(backup, null, 2);
  return {
    backup,
    blob: new Blob([json], { type: 'application/json' }),
  };
}
