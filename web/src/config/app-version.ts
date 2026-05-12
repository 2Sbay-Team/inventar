// v0.6.3 — single source of truth for the app version surfaced
// to merchants (Settings → About) and stamped onto exported
// backups (backup/export.ts via downloadBackupFile). Manually
// mirrors package.json's "version" field — bump both when
// releasing.
//
// The Settings "About" section reads this; useAutoBackup and the
// "Export data" path both pass it through to exportBackupBlob so
// the JSON envelope's `app_version` field is consistent across
// every write site.

export const APP_VERSION = '1.0.0';
