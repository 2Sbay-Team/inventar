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
  // v0.5 ADR-017: set after the v6→v7 upgrade callback completes.
  // No banner needed (the migration is unambiguous), but the timestamp
  // is useful for debugging and for the e2e migration smoke spec.
  migration_v7_completed_at: 'migration_v7_completed_at',
  // v0.5 ADR-019: number of days ahead the daily expiry sweep should
  // look for soon-to-expire lots. Default 7 days. Settings exposes a
  // picker (3 / 7 / 14 / 30) — the value is read on every dashboard
  // mount.
  expiry_threshold_days: 'expiry_threshold_days',
  // v0.5 ADR-018 (gap-fix opt-in): when true, /receive and /sell use
  // strict EAN-13 checksum validation instead of the loose 12-or-13-
  // digit check. Default false (matches the v0.5 plan's loose-only
  // decision). The merchant turns it on in Settings only if their
  // catalogue is exclusively real EAN-13s — UPC-A or in-house codes
  // would be rejected otherwise.
  ean_strict: 'ean_strict',
  // v0.5.2 ADR-021: set after the v8→v9 upgrade callback completes.
  // The /migrations/confirm-subtypes route + the migration banner read
  // this in tandem with `migration_v9_subtypes_confirmed_at` to decide
  // whether to surface the "We've simplified your shop categories"
  // prompt.
  migration_v9_completed_at: 'migration_v9_completed_at',
} as const;

// v0.5 ADR-019: per-variant snooze for the expiry banner. The banner
// hides one variant for N days when the merchant taps "Hide for 7 days"
// in /expiry. We store one meta row per snoozed variant rather than a
// table because expirations naturally clear themselves once stock sells
// through, so the row count stays small.
export function expirySnoozeKey(variantId: string): string {
  return `expiry_snooze_${variantId}`;
}
