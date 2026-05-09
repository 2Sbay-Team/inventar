// v5 → v6 transformation kernel — single source of truth used by both the
// Dexie version(6) upgrade callback (for in-place migration on next app
// launch) and the backup import path (for reading legacy
// inventar-export-v1 files into a v6-shape store). ADR-011 moved colour
// off Article and onto Variant; ADR-012 added the location dimension to
// Movement plus the new 'transfer' / 'damage' types.
//
// The transform is pure: it takes the v5 row arrays and the v5 profile
// (for store_type lookup), returns the v6 row arrays plus a small report
// the caller can inspect or surface to the user. No I/O, no Dexie calls.

import { type StoreType, type UUID } from '../types';
import { newUUID } from '../utils/uuid';

// ---------- Frozen v5 row shapes ----------
// Defined inline rather than importing the legacy types from elsewhere so
// future edits to the canonical types module can never silently change
// the meaning of "v5 row" here.

export interface V5ShopProfile {
  id: 'singleton';
  name: string;
  locale: string;
  logo_photo_id: UUID | null;
  currency: string;
  store_type: StoreType;
  created_at: string;
  updated_at: string;
  last_backup_at: string | null;
}

export interface V5Article {
  id: UUID;
  internal_code: string;
  name: string;
  photo_id: UUID | null;
  category: string;
  colors: string[];
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  search_blob: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface V5Variant {
  id: UUID;
  article_id: UUID;
  size: string | null;
  hidden: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface V5Movement {
  id: UUID;
  variant_id: UUID;
  delta: number;
  type: 'sale' | 'purchase' | 'adjustment' | 'return';
  note: string | null;
  unit_price_tnd: number | null;
  created_at: string;
  deleted_at: string | null;
}

// ---------- v6 row shapes (subset that the migration produces) ----------

// colours[] stays as a denormalised cache during the v0.3 transition.
// Removed from the type entirely in commit 7.
export type V6Article = V5Article;

export interface V6Variant {
  id: UUID;
  article_id: UUID;
  color: string | null;
  size: string | null;
  photo_id: UUID | null;
  hidden: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface V6Movement {
  id: UUID;
  variant_id: UUID;
  delta: number;
  type: 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer' | 'damage';
  note: string | null;
  unit_price_tnd: number | null;
  location: 'floor' | 'back' | null;
  transfer_from: 'floor' | 'back' | null;
  transfer_to: 'floor' | 'back' | null;
  created_at: string;
  deleted_at: string | null;
}

// ---------- Public API ----------

export interface V5Snapshot {
  profile: V5ShopProfile | null;
  articles: V5Article[];
  variants: V5Variant[];
  movements: V5Movement[];
}

export interface MigratedRows {
  // Article rows — same shape as input but with `colors` re-derived from
  // the produced variants so the denormalised cache stays in sync.
  articles: V6Article[];
  // Concatenation of: every legacy v5 variant (soft-deleted via the new
  // `deleted_at = nowISO`) + every newly-fanned-out v6 variant. Keeping
  // the legacy rows means an old backup re-imported still finds the
  // variants by id.
  variants: V6Variant[];
  // Every v5 movement remapped to a new variant_id and assigned a default
  // location='back'. Movements whose old variant fanned out to multiple
  // new variants pick the alphabetically-first colour and gain a "(migrated
  // v5→v6; assigned to {color} — verify)" suffix on their note so the
  // review screen can find them.
  movements: V6Movement[];
}

export interface MigrationReport {
  // Number of new variants created by the colour fan-out.
  newVariantsCreated: number;
  // Number of v5 variants soft-deleted (one per article × variant pair).
  legacyVariantsTombstoned: number;
  // Movements whose old variant id mapped to ≥2 new variants — flagged
  // with the marker note for the user to review.
  movementsFlaggedForReview: number;
  // Movements whose variant_id wasn't in the mapping at all (orphaned).
  // They get tombstoned (deleted_at set) AND the marker note appended so
  // the review screen lists them and the user can confirm or hard-delete.
  movementsOrphaned: number;
}

// Marker substring used to detect movements that need user review on the
// migration banner. Exported so the banner predicate stays in sync with
// the migration writer.
export const MIGRATION_MARKER = '(migrated v5→v6';

// Stable colour fallback for legacy shoes/clothes articles whose `colors`
// array was empty at the time of the migration. The literal text is
// surfaced verbatim in the review screen — keep it short and obvious.
export const LEGACY_COLOR_PLACEHOLDER = '(legacy)';

function nowISO(): string {
  return new Date().toISOString();
}

// Returns the list of colours to fan a single Article out across, given
// the active store_type. Empty input → either ['(legacy)'] (if the active
// vertical uses colours) or [null] (if not). Non-empty input is lowercased
// and de-duplicated to mirror createArticle's storage rule.
function effectiveColors(rawColors: string[], storeType: StoreType | null): Array<string | null> {
  const verticalUsesColors = storeType === 'shoes' || storeType === 'clothes';
  const cleaned = rawColors.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0);
  const unique = Array.from(new Set(cleaned));
  if (unique.length > 0) return unique;
  return verticalUsesColors ? [LEGACY_COLOR_PLACEHOLDER] : [null];
}

// Comparator used to pick the alphabetically-first colour for ambiguous
// movement reattribution. `null` < everything else so a colourless variant
// wins ties (relevant only for grocery/kiosk legacy with empty colours,
// which produces a single null variant anyway — no actual ambiguity).
function colorSort(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a.localeCompare(b);
}

export function migrateRowsV5ToV6(snapshot: V5Snapshot): {
  rows: MigratedRows;
  report: MigrationReport;
} {
  const ts = nowISO();
  const storeType = snapshot.profile?.store_type ?? null;

  // oldVariantId → ordered list of new variants it fanned out to. We keep
  // them sorted by `color` so movement reattribution is deterministic.
  const fanOut = new Map<UUID, V6Variant[]>();

  const newVariants: V6Variant[] = [];
  const tombstonedLegacyVariants: V6Variant[] = [];
  const articlesById = new Map<UUID, V5Article>();
  for (const a of snapshot.articles) articlesById.set(a.id, a);

  // Group legacy variants by article so we can iterate per-article and
  // know the source row's identity for each new variant we create.
  const legacyByArticle = new Map<UUID, V5Variant[]>();
  for (const v of snapshot.variants) {
    const arr = legacyByArticle.get(v.article_id);
    if (arr) arr.push(v);
    else legacyByArticle.set(v.article_id, [v]);
  }

  for (const article of snapshot.articles) {
    const colors = effectiveColors(article.colors ?? [], storeType);
    const sorted = [...colors].sort(colorSort);
    const legacyVariants = legacyByArticle.get(article.id) ?? [];

    for (const lv of legacyVariants) {
      const fanned: V6Variant[] = sorted.map((c) => ({
        id: newUUID(),
        article_id: lv.article_id,
        color: c,
        size: lv.size,
        photo_id: null,
        hidden: lv.hidden,
        updated_at: ts,
        deleted_at: null,
      }));
      fanOut.set(lv.id, fanned);
      newVariants.push(...fanned);

      // Soft-delete the legacy variant. We carry forward the v5 row by
      // back-filling the new v6 fields with neutral defaults so it is
      // schema-valid in v6 but invisible to live queries (deleted_at !=
      // null and no colour to match against).
      tombstonedLegacyVariants.push({
        id: lv.id,
        article_id: lv.article_id,
        color: null,
        size: lv.size,
        photo_id: null,
        hidden: lv.hidden,
        updated_at: ts,
        deleted_at: ts,
      });
    }
  }

  // Movement remap. For each v5 movement: look up the fan-out, point
  // variant_id at the chosen new id, default location='back', flag the
  // ambiguous and orphan cases.
  const remappedMovements: V6Movement[] = [];
  let movementsFlaggedForReview = 0;
  let movementsOrphaned = 0;

  for (const m of snapshot.movements) {
    const fanned = fanOut.get(m.variant_id);

    if (!fanned || fanned.length === 0) {
      // Orphan — variant_id wasn't in any article's legacy variant list.
      // Tombstone the movement so it stops affecting stock counts but
      // keep it for the review screen.
      movementsOrphaned += 1;
      const orphanNote = appendMarker(m.note, 'orphan — variant lost');
      remappedMovements.push({
        ...mapV5MovementBase(m),
        location: 'back',
        transfer_from: null,
        transfer_to: null,
        note: orphanNote,
        deleted_at: ts,
      });
      continue;
    }

    if (fanned.length === 1) {
      // Unambiguous remap.
      const target = fanned[0]!;
      remappedMovements.push({
        ...mapV5MovementBase(m),
        variant_id: target.id,
        location: 'back',
        transfer_from: null,
        transfer_to: null,
      });
      continue;
    }

    // Ambiguous: ≥2 colours. Pick the alphabetically-first.
    movementsFlaggedForReview += 1;
    const target = fanned[0]!;
    const flaggedNote = appendMarker(m.note, `assigned to ${target.color ?? '(none)'} — verify`);
    remappedMovements.push({
      ...mapV5MovementBase(m),
      variant_id: target.id,
      location: 'back',
      transfer_from: null,
      transfer_to: null,
      note: flaggedNote,
    });
  }

  // Articles are passed through unchanged in shape but their `colors`
  // cache is recomputed from the new variants so legacy reads stay
  // consistent during the transition.
  const articlesOut: V6Article[] = snapshot.articles.map((a) => ({
    ...a,
    colors: uniqueArticleColors(a.id, newVariants),
  }));

  return {
    rows: {
      articles: articlesOut,
      variants: [...tombstonedLegacyVariants, ...newVariants],
      movements: remappedMovements,
    },
    report: {
      newVariantsCreated: newVariants.length,
      legacyVariantsTombstoned: tombstonedLegacyVariants.length,
      movementsFlaggedForReview,
      movementsOrphaned,
    },
  };
}

function mapV5MovementBase(m: V5Movement): V6Movement {
  return {
    id: m.id,
    variant_id: m.variant_id,
    delta: m.delta,
    type: m.type,
    note: m.note,
    unit_price_tnd: m.unit_price_tnd,
    location: 'back',
    transfer_from: null,
    transfer_to: null,
    created_at: m.created_at,
    deleted_at: m.deleted_at,
  };
}

function appendMarker(existing: string | null, suffix: string): string {
  const marker = `${MIGRATION_MARKER}; ${suffix})`;
  if (!existing || existing.trim() === '') return marker;
  return `${existing} ${marker}`;
}

function uniqueArticleColors(articleId: UUID, variants: V6Variant[]): string[] {
  const set = new Set<string>();
  for (const v of variants) {
    if (v.article_id !== articleId) continue;
    if (v.color === null) continue;
    set.add(v.color);
  }
  return Array.from(set);
}
