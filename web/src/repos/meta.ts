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
  // v0.5.2 ADR-021: set when the merchant confirms their subtypes via
  // the /migrations/confirm-subtypes screen (post-migration), OR when
  // a brand-new profile completes onboarding (so the banner never
  // shows for fresh installs that picked their subtypes themselves).
  migration_v9_subtypes_confirmed_at: 'migration_v9_subtypes_confirmed_at',
  // v0.5.2 ADR-021: ISO timestamp through which the migration banner
  // is suppressed. Set when the merchant taps "Hide for 7 days" on
  // the home banner. Re-shows after the timestamp passes.
  migration_v9_banner_hidden_until: 'migration_v9_banner_hidden_until',
  // v0.5.2 ADR-018: alerts banner suppression. Set when the merchant
  // taps "Hide for 7 days" on the consolidated alerts banner.
  alerts_banner_hidden_until: 'alerts_banner_hidden_until',
  // Companion to alerts_banner_hidden_until: snapshot of the alert
  // count at the moment of hide. Banner re-shows if current count
  // exceeds this snapshot (so a new alert arriving mid-suppression
  // still surfaces).
  alerts_banner_hidden_count_snapshot: 'alerts_banner_hidden_count_snapshot',
  // v0.5.2.4 ADR-024: per-year invoice sequence counter. Stored as a
  // map { '2026': 42, '2025': 117 } so we can roll over the per-year
  // numbering without losing prior years' next-numbers. The
  // /sell-side invoice issuer reads + increments this atomically
  // inside the same Dexie transaction that writes the invoice row.
  invoice_counter: 'invoice_counter',
  // v0.6 ADR-031: user-controlled update consent flow. The picker on
  // a waiting SW honours these.
  //   update_snooze_until    — ISO timestamp; modal suppressed while
  //                            now() < this
  //   update_snoozed_version — version string the snooze was set for;
  //                            cleared automatically when a different
  //                            version becomes available
  //   update_skipped_versions— array<string>; modal never re-shows for
  //                            any version in this list
  //   update_just_installed  — version string written immediately
  //                            before reload-on-consent; on next boot
  //                            we surface a one-shot "Welcome to vX"
  //                            toast and clear the key
  update_snooze_until: 'update_snooze_until',
  update_snoozed_version: 'update_snoozed_version',
  update_skipped_versions: 'update_skipped_versions',
  update_just_installed: 'update_just_installed',
} as const;

// v0.5 ADR-019: per-variant snooze for the expiry banner. The banner
// hides one variant for N days when the merchant taps "Hide for 7 days"
// in /expiry. We store one meta row per snoozed variant rather than a
// table because expirations naturally clear themselves once stock sells
// through, so the row count stays small.
export function expirySnoozeKey(variantId: string): string {
  return `expiry_snooze_${variantId}`;
}
