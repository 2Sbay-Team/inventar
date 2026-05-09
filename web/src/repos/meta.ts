import { type InventarDB } from '../db/db';

// Generic key-value access against the `meta` table. Used for app-level
// preferences that don't deserve their own typed table: persisted locale,
// recent searches, persistence-flag-was-requested, dismissed banners, etc.

export async function getMeta<T>(db: InventarDB, key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(db: InventarDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(db: InventarDB, key: string): Promise<void> {
  await db.meta.delete(key);
}

// Well-known meta keys, defined here so misspellings get caught at compile.
export const META_KEYS = {
  locale: 'locale',
  recent_searches: 'recent_searches',
  persistence_requested: 'persistence_requested',
  backup_banner_dismissed_at: 'backup_banner_dismissed_at',
  install_banner_dismissed_at: 'install_banner_dismissed_at',
  last_seen_version: 'last_seen_version',
  auto_backup_handle: 'auto_backup_handle',
  auto_backup_folder_name: 'auto_backup_folder_name',
  auto_backup_at: 'auto_backup_at',
  // v0.3 (ADR-011): set after the v5→v6 upgrade callback completes.
  // The migration-review screen and home banner read this to decide
  // whether to surface the "some movements need verification" prompt.
  migration_v6_completed_at: 'migration_v6_completed_at',
  // ISO timestamp through which the migration banner is suppressed.
  // Re-shows after the timestamp passes; only set when the user taps
  // "Hide for now" with markers still outstanding.
  migration_banner_hidden_until: 'migration_banner_hidden_until',
} as const;
