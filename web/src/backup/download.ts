import { db as appDB, type InventarDB } from '../db/db';
import { markBackedUp } from '../repos/profile';
import { backupFilename, exportBackupBlob } from './export';

// v0.6.2 ADR-032 — shared "build a backup, push it through an
// anchor download, mark the profile as backed up" helper. Pulled out
// of the Settings screen so the v0.6.2 update modal can trigger the
// exact same flow from inside its risk-warning block without
// duplicating the eight-line dance.
//
// Caveat: the browser save dialog isn't observable from JS, so this
// resolves as soon as the click is dispatched — not when the user
// actually picks a save location. That's the same trust level the
// Settings export has carried since v0.1 (markBackedUp is called
// immediately after the click), so callers can rely on a resolved
// promise as "blob handoff completed without throwing".

export interface DownloadBackupOptions {
  appVersion: string;
  // Override only used by tests — the production caller always wants
  // the date-suffixed default.
  filename?: string;
  // Override hook so tests can intercept the anchor-click. Production
  // callers omit it and get the standard <a download> path.
  triggerDownload?: (blob: Blob, filename: string) => void;
}

function defaultTriggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadBackupFile(
  options: DownloadBackupOptions,
  db: InventarDB = appDB,
): Promise<void> {
  const { blob } = await exportBackupBlob(db, { appVersion: options.appVersion });
  const filename = options.filename ?? backupFilename();
  (options.triggerDownload ?? defaultTriggerDownload)(blob, filename);
  await markBackedUp(db);
}
