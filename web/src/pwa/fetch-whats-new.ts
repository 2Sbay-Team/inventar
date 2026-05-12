import { type Locale } from '../types';

// v0.6 ADR-031 — fetch the *new* whats-new.json that ships with the
// waiting SW. We cache-bust the URL so the active SW's precache (which
// holds the OLD whats-new.json) doesn't intercept; the request falls
// through to the network and we get the freshly-deployed file.
//
// Offline (no network, no cached match for the cache-busted URL) the
// fetch fails — caller falls back to a generic "improvements and bug
// fixes" copy per the v0.6 brief.
//
// v0.6.2 ADR-032 — the payload gains optional risk fields so the
// modal can warn merchants before a data-modifying or non-rollback-
// able update. Validation is strict: when `risk_level` claims
// 'migration' or 'breaking', the `migration` block MUST be a fully-
// shaped MigrationInfo, otherwise the whole payload is rejected and
// the caller falls through to the SKIP_SENTINEL_UNKNOWN path. This
// catches authoring mistakes during deploy rather than silently
// showing reassurance copy on a risky update.

export type RiskLevel = 'safe' | 'migration' | 'breaking';

export interface MigrationInfo {
  // One-line, localized summary shown in the warning block.
  summary: Record<Locale, string>;
  // Free-form list of affected domains/tables (e.g. ['articles',
  // 'variants']). Rendered as a comma-joined list in the modal.
  data_affected: readonly string[];
  // Short reassurance sentence (e.g. "No rows are deleted"). One
  // string, locale-neutral by design — release notes and migration
  // tooling write technical text here, not merchant-facing copy.
  data_preservation: string;
  // Whether installing this version is reversible by reverting to a
  // prior SW. Drives the 'migration' vs 'breaking' visual treatment
  // when the author downgrades a breaking update by mistake (the
  // modal still respects the explicit risk_level).
  rollback_supported: boolean;
}

export interface BackupFormatChange {
  // Format identifiers (e.g. 'v3', 'v4'). Free text — the backup
  // module owns the canonical strings.
  from: string;
  to: string;
  // True when a backup exported by the OLD app can still be imported
  // by the NEW app. False = old backups become unreadable post-upgrade.
  backwards_compatible_import: boolean;
  // True when a backup exported by the NEW app can still be imported
  // by the OLD app. False = once the merchant upgrades, downgrading
  // means losing every backup taken post-upgrade.
  forwards_compatible_export: boolean;
}

export interface WhatsNew {
  version: string;
  released_at: string;
  // Always present after parseWhatsNew(); missing inputs normalize to
  // 'safe'. The Modal branches off this value.
  risk_level: RiskLevel;
  // Always present after normalization; null for 'safe' updates.
  // For 'migration' / 'breaking' the validator guarantees this is a
  // fully-shaped MigrationInfo.
  migration: MigrationInfo | null;
  // Independent of risk_level — a 'safe' update can still bump the
  // backup format if the change is fully bi-directional. Null when
  // unchanged.
  backup_format_change: BackupFormatChange | null;
  highlights: Record<Locale, readonly string[]>;
}

// Internal raw shape. The validator works on this; parseWhatsNew()
// promotes a Raw to a WhatsNew by filling in the optional fields.
interface RawWhatsNew {
  version: string;
  released_at: string;
  risk_level?: RiskLevel;
  migration?: MigrationInfo | null;
  backup_format_change?: BackupFormatChange | null;
  highlights: Record<Locale, readonly string[]>;
}

const LOCALES: readonly Locale[] = ['en', 'fr', 'ar'];
const RISK_LEVELS: readonly RiskLevel[] = ['safe', 'migration', 'breaking'];

function isLocalizedStringMap(input: unknown): input is Record<Locale, string> {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  return LOCALES.every((l) => typeof obj[l] === 'string');
}

function isLocalizedHighlightsMap(input: unknown): input is Record<Locale, readonly string[]> {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  return LOCALES.every((l) => {
    const arr = obj[l];
    return Array.isArray(arr) && arr.every((s) => typeof s === 'string');
  });
}

function isValidMigrationInfo(input: unknown): input is MigrationInfo {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  if (!isLocalizedStringMap(obj.summary)) return false;
  if (!Array.isArray(obj.data_affected)) return false;
  if (!obj.data_affected.every((s) => typeof s === 'string')) return false;
  if (typeof obj.data_preservation !== 'string') return false;
  if (typeof obj.rollback_supported !== 'boolean') return false;
  return true;
}

function isValidBackupFormatChange(input: unknown): input is BackupFormatChange {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.from !== 'string' || obj.from.trim() === '') return false;
  if (typeof obj.to !== 'string' || obj.to.trim() === '') return false;
  if (typeof obj.backwards_compatible_import !== 'boolean') return false;
  if (typeof obj.forwards_compatible_export !== 'boolean') return false;
  return true;
}

export function isValidWhatsNew(input: unknown): input is RawWhatsNew {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.version !== 'string' || obj.version.trim() === '') return false;
  if (typeof obj.released_at !== 'string') return false;
  if (!isLocalizedHighlightsMap(obj.highlights)) return false;

  // risk_level — optional, but if present must be one of the three
  // strings. Missing maps to 'safe' downstream in parseWhatsNew.
  const rawRisk = obj.risk_level;
  let normalizedRisk: RiskLevel = 'safe';
  if (rawRisk !== undefined) {
    if (typeof rawRisk !== 'string' || !RISK_LEVELS.includes(rawRisk as RiskLevel)) {
      return false;
    }
    normalizedRisk = rawRisk as RiskLevel;
  }

  // migration — null/missing allowed only on 'safe'. On 'migration'
  // or 'breaking' the block must be a valid MigrationInfo.
  const rawMigration = obj.migration;
  if (rawMigration !== undefined && rawMigration !== null) {
    if (!isValidMigrationInfo(rawMigration)) return false;
  } else if (normalizedRisk !== 'safe') {
    return false;
  }

  // backup_format_change — independent of risk_level. If present,
  // must be a fully-shaped BackupFormatChange.
  const rawBackup = obj.backup_format_change;
  if (rawBackup !== undefined && rawBackup !== null) {
    if (!isValidBackupFormatChange(rawBackup)) return false;
  }

  return true;
}

// Normalizes a validated raw payload into a WhatsNew with all
// optional fields filled in. Always pair with isValidWhatsNew.
export function parseWhatsNew(input: unknown): WhatsNew | null {
  if (!isValidWhatsNew(input)) return null;
  return {
    version: input.version,
    released_at: input.released_at,
    risk_level: input.risk_level ?? 'safe',
    migration: input.migration ?? null,
    backup_format_change: input.backup_format_change ?? null,
    highlights: input.highlights,
  };
}

export async function fetchWhatsNew(): Promise<WhatsNew | null> {
  try {
    // Cache-busting query string forces the request past workbox's
    // exact-URL precache match.
    const res = await fetch(`/whats-new.json?_=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return parseWhatsNew(json);
  } catch (err) {
    console.warn('[fetch-whats-new] failed', err);
    return null;
  }
}
