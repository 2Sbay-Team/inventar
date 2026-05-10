import type { Article, Locale, Movement, ShopProfile, ShopSubtype, StoreType } from '../types';

// v0.5 ADR-017 / ADR-018 / ADR-019 — pure migration kernel for v6 → v7.
//
// Why this lives here, not inline in db.ts: the kernel is a pure
// function over plain JS rows. It has no Dexie dependency, so vitest
// with fake-indexeddb can hammer it with fixtures (kiosk + grocery +
// shoes mix) without going through the IndexedDB upgrade pipeline.
// The upgrade callback in db.ts is a thin shell that reads → calls
// kernel → writes back.
//
// Three transformations:
//   1. ShopProfile.store_type 'kiosk' → 'shop' + shop_subtypes set to
//      ['tobacco_lottery', 'snacks_confectionery'].
//   2. ShopProfile.store_type 'grocery' → 'shop' + shop_subtypes set to
//      ['food_beverages'].
//   3. Every other store_type unchanged; shop_subtypes initialised to
//      [] so the field is always present (the type signature is
//      non-optional).
//   4. Articles get barcode_ean=null + min_stock_threshold=null.
//   5. Movements get transaction_id=null + expires_at=null + lot_id=null.
//
// No Lot rows are backfilled — the legacy schema had no expiry data, so
// we have nothing to convert. Lots only come into being when a /receive
// session writes a purchase movement with expires_at set.

// Snapshot of the v6 ShopProfile shape (before this migration ran).
// Captured here so the kernel doesn't depend on the live `ShopProfile`
// type, which has already moved to v7 (with the narrower StoreType).
export interface V6ShopProfile {
  id: 'singleton';
  name: string;
  locale: string;
  logo_photo_id: string | null;
  currency: string;
  // Legacy union — wider than the v7 type. Kiosk/grocery rows live here.
  store_type: 'shoes' | 'clothes' | 'kiosk' | 'grocery' | 'shop';
  created_at: string;
  updated_at: string;
  last_backup_at: string | null;
}

// Snapshot of the v6 Article. Same as v7 minus the new fields.
export interface V6Article {
  id: string;
  internal_code: string;
  name: string;
  photo_id: string | null;
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

// Snapshot of the v6 Movement. Same as v7 minus the three new fields.
export interface V6Movement {
  id: string;
  variant_id: string;
  delta: number;
  type: string;
  note: string | null;
  unit_price_tnd: number | null;
  location: string | null;
  transfer_from: string | null;
  transfer_to: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface MigrateInput {
  profile: V6ShopProfile | null;
  articles: V6Article[];
  movements: V6Movement[];
}

export interface MigrateOutput {
  rows: {
    profile: ShopProfile | null;
    articles: Article[];
    movements: Movement[];
  };
}

// Mapping table for the legacy → shop_subtypes derivation. Brief is
// explicit: kiosk → tobacco + snacks; grocery → food. Drinks is left out
// of the kiosk default by design — most kiosks DO sell drinks but the
// brief picked these two as the "core" sub-types and lets the merchant
// add food_beverages on first launch.
const LEGACY_TO_SUBTYPES: Record<'kiosk' | 'grocery', ShopSubtype[]> = {
  kiosk: ['tobacco_lottery', 'snacks_confectionery'],
  grocery: ['food_beverages'],
};

export function migrateRowsV6ToV7(input: MigrateInput): MigrateOutput {
  const profile = input.profile ? migrateProfile(input.profile) : null;
  const articles = input.articles.map(migrateArticle);
  const movements = input.movements.map(migrateMovement);
  return { rows: { profile, articles, movements } };
}

function migrateProfile(p: V6ShopProfile): ShopProfile {
  // Cast `locale` once: the v6 row had `locale: string` (no enum) but
  // every value the previous schema actually allowed is one of 'fr' /
  // 'ar' / 'en'. The v3 migration wrote 'TND' as currency; locale was
  // never widened beyond the 3-locale set.
  const base = {
    id: 'singleton' as const,
    name: p.name,
    locale: p.locale as Locale,
    logo_photo_id: p.logo_photo_id,
    currency: p.currency,
    created_at: p.created_at,
    updated_at: p.updated_at,
    last_backup_at: p.last_backup_at,
  };
  // Already on v7? Defensive — if a re-run lands on a row that's already
  // 'shop' with subtypes set, leave it alone.
  if (p.store_type === 'shop') {
    return {
      ...base,
      store_type: 'shop',
      shop_subtypes: (p as unknown as { shop_subtypes?: ShopSubtype[] }).shop_subtypes ?? [],
    };
  }
  if (p.store_type === 'kiosk' || p.store_type === 'grocery') {
    return {
      ...base,
      store_type: 'shop',
      shop_subtypes: LEGACY_TO_SUBTYPES[p.store_type],
    };
  }
  // shoes / clothes pass through unchanged (other than ensuring the new
  // field is present and an empty array — the type insists on string[],
  // not string[] | undefined).
  return {
    ...base,
    store_type: p.store_type as StoreType,
    shop_subtypes: [],
  };
}

function migrateArticle(a: V6Article): Article {
  return {
    ...a,
    barcode_ean: null,
    min_stock_threshold: null,
  };
}

function migrateMovement(m: V6Movement): Movement {
  // Cast for the narrower v7 unions (MovementType, Location). The kernel
  // doesn't validate v6 row well-formedness — Dexie schema would have
  // rejected anything off-spec on the way in.
  return {
    ...(m as unknown as Movement),
    transaction_id: null,
    expires_at: null,
    lot_id: null,
  };
}
