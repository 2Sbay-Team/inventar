import type {
  Article,
  FashionSubtype,
  Locale,
  ShopProfile,
  ShopSubtype,
  StoreType,
} from '../types';

// v0.5.2 ADR-021 / ADR-022 / ADR-023 — pure migration kernel for v8 → v9.
//
// Same shape as the v6→v7 kernel: a pure function over plain JS rows so
// vitest with fake-indexeddb can hammer it with fixtures (shoes / clothes /
// shop / already-fashion mix) without going through the IndexedDB upgrade
// pipeline. The Dexie upgrade callback in db.ts is a thin shell that
// reads meta + rows → calls this kernel → writes back.
//
// Six transformations:
//   1. ShopProfile.store_type 'shoes'  → 'fashion' + fashion_subtypes
//      = ['shoes'].
//   2. ShopProfile.store_type 'clothes' → 'fashion' + fashion_subtypes
//      = ['clothing_men', 'clothing_women'].
//   3. Every other store_type unchanged (shop stays shop; already-
//      fashion profiles are idempotent).
//   4. ShopProfile gets location_floor_label + location_back_label set
//      from the locale-specific default for the merchant's NEW vertical
//      (post-merge). Existing non-empty labels are preserved (the
//      merchant may have customised them between v9 ship and a Dexie
//      history replay; we never clobber merchant input).
//   5. ShopProfile gets expiry_warning_days = meta.expiry_threshold_days
//      (the pre-v9 global) if non-null, else 7. The meta key is left
//      readable for one release for backup-restore back-compat (see
//      NON_GOALS: drop in v0.7+).
//   6. Articles get expiry_alert_days = null (per-article override
//      starts unset; merchants set it from Article Detail).
//
// No Lot rows or Movement rows are touched — v9 is additive on those
// tables (no schema changes).

// Snapshot of the v8 ShopProfile shape (before this migration ran).
// Captured here so the kernel doesn't depend on the live `ShopProfile`
// type, which has already moved to v9 (with the new label / threshold
// fields). Note: shop_subtypes was added in v7; we preserve it.
export interface V8ShopProfile {
  id: 'singleton';
  name: string;
  locale: string;
  logo_photo_id: string | null;
  currency: string;
  store_type: 'shoes' | 'clothes' | 'shop' | 'fashion';
  shop_subtypes: ShopSubtype[];
  // The fields v9 introduces may still be present on a row that the
  // chained v6→v7 kernel pre-filled (defensive defaults). We tolerate
  // either shape and let the v9 logic decide whether to keep the
  // existing value or replace it.
  fashion_subtypes?: FashionSubtype[];
  location_floor_label?: string;
  location_back_label?: string;
  expiry_warning_days?: number;
  created_at: string;
  updated_at: string;
  last_backup_at: string | null;
}

// Snapshot of the v8 Article. v9 only adds expiry_alert_days.
export interface V8Article {
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
  barcode_ean: string | null;
  min_stock_threshold: number | null;
  expiry_alert_days?: number | null;
  search_blob: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface MigrateInput {
  profile: V8ShopProfile | null;
  articles: V8Article[];
  // The pre-v9 global expiry threshold lived as a meta row. Pass its
  // value (or null) so the kernel can copy it to the profile column.
  expiryThresholdDaysMeta: number | null;
}

export interface MigrateOutput {
  rows: {
    profile: ShopProfile | null;
    articles: Article[];
  };
}

// v0.5.2 ADR-021: shoes → fashion (just shoes), clothes → fashion (men +
// women). The migration confirmation banner is the safety net for
// merchants whose actual mix differs (a clothes store that's mostly
// kids' clothing can edit in Settings).
const LEGACY_TO_FASHION_SUBTYPES: Record<'shoes' | 'clothes', FashionSubtype[]> = {
  shoes: ['shoes'],
  clothes: ['clothing_men', 'clothing_women'],
};

// v0.5.2 ADR-022: locale-aware default labels per vertical, real retail
// terminology. Merchant overrides in Settings persist through subsequent
// locale switches (the labels are merchant-customisable strings, not
// translations).
interface LocationLabels {
  floor: string;
  back: string;
}

const LOCATION_LABEL_DEFAULTS: Record<'fashion' | 'shop', Record<Locale, LocationLabels>> = {
  fashion: {
    en: { floor: 'Shop floor', back: 'Stockroom' },
    fr: { floor: 'Boutique', back: 'Réserve' },
    ar: { floor: 'المحل', back: 'المخزن' },
  },
  shop: {
    en: { floor: 'Shelf', back: 'Stockroom' },
    fr: { floor: 'Rayon', back: 'Réserve' },
    ar: { floor: 'الرف', back: 'المخزن' },
  },
};

const DEFAULT_EXPIRY_WARNING_DAYS = 7;

export function defaultLocationLabels(
  vertical: 'fashion' | 'shop',
  locale: Locale,
): LocationLabels {
  return LOCATION_LABEL_DEFAULTS[vertical][locale];
}

export function migrateRowsV8ToV9(input: MigrateInput): MigrateOutput {
  const profile = input.profile
    ? migrateProfile(input.profile, input.expiryThresholdDaysMeta)
    : null;
  const articles = input.articles.map(migrateArticle);
  return { rows: { profile, articles } };
}

function migrateProfile(p: V8ShopProfile, expiryMeta: number | null): ShopProfile {
  // Resolve the post-migration vertical first; everything downstream
  // (location-label defaults, fashion_subtypes assignment) hinges on it.
  let storeType: StoreType;
  let fashion_subtypes: FashionSubtype[];
  if (p.store_type === 'shoes' || p.store_type === 'clothes') {
    storeType = 'fashion';
    // Empty array is treated as "needs filling" — the v6→v7 chained
    // migration pre-fills fashion_subtypes=[] as a type-check sentinel,
    // and we want the legacy-to-fashion mapping to fire for those
    // chained-from-v6 rows. A non-empty existing value is preserved
    // (true idempotency for already-set fashion profiles).
    const existing = p.fashion_subtypes ?? [];
    fashion_subtypes = existing.length > 0 ? existing : LEGACY_TO_FASHION_SUBTYPES[p.store_type];
  } else if (p.store_type === 'fashion') {
    // Already-fashion (idempotent path). Same empty-as-needs-filling
    // rule applies — but with no legacy mapping to derive from, we
    // default to ['shoes'] so the picker has SOMETHING checked when
    // the merchant visits the confirmation screen.
    storeType = 'fashion';
    const existing = p.fashion_subtypes ?? [];
    fashion_subtypes = existing.length > 0 ? existing : ['shoes'];
  } else {
    // 'shop' — store_type unchanged; fashion_subtypes is the empty array
    // contract for non-fashion verticals. shop_subtypes is preserved
    // verbatim (legacy keys like 'tobacco_lottery' / 'parapharmaceutique'
    // round-trip — see ADR-021 ambiguity #4).
    storeType = 'shop';
    fashion_subtypes = [];
  }
  const locale = (p.locale as Locale) ?? 'en';
  // Vertical for label defaults: 'fashion' for shoes/clothes/fashion
  // profiles, 'shop' for everything else.
  const verticalForLabels: 'fashion' | 'shop' = storeType === 'shop' ? 'shop' : 'fashion';
  const labelDefaults = LOCATION_LABEL_DEFAULTS[verticalForLabels][locale];
  // Preserve any non-empty merchant-set labels — only fall back to the
  // default when the value is missing or the empty string. This matters
  // for chained migrations (the v6→v7 kernel sets '' as a placeholder
  // and we want the v9 logic to fill it in here).
  const floorLabel =
    p.location_floor_label && p.location_floor_label.trim() !== ''
      ? p.location_floor_label
      : labelDefaults.floor;
  const backLabel =
    p.location_back_label && p.location_back_label.trim() !== ''
      ? p.location_back_label
      : labelDefaults.back;
  const expiryWarningDays = p.expiry_warning_days ?? expiryMeta ?? DEFAULT_EXPIRY_WARNING_DAYS;
  return {
    id: 'singleton',
    name: p.name,
    locale,
    logo_photo_id: p.logo_photo_id,
    currency: p.currency,
    store_type: storeType,
    shop_subtypes: p.shop_subtypes,
    fashion_subtypes,
    location_floor_label: floorLabel,
    location_back_label: backLabel,
    expiry_warning_days: expiryWarningDays,
    // v0.5.2.4 ADR-024: invoicing fields default to null on the v8→v9
    // hop. The v9→v10 upgrade backfills them on existing installs too,
    // but we set them here so the kernel returns a fully-typed v9 row
    // even when run in isolation by the test suite.
    legal_name: null,
    legal_address: null,
    fiscal_id: null,
    default_vat_pct: null,
    // v0.5.2.7: phone column added in v11. We default it here too so a
    // v8→v9 in-isolation test run still produces a ShopProfile that
    // satisfies the current TS shape. v9→v10 (invoice block) and the
    // new v10→v11 (phone) upgrades backfill on existing installs.
    phone: null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    last_backup_at: p.last_backup_at,
  };
}

function migrateArticle(a: V8Article): Article {
  return {
    ...(a as unknown as Article),
    expiry_alert_days: a.expiry_alert_days ?? null,
  };
}
