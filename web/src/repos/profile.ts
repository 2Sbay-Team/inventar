import { type InventarDB } from '../db/db';
import {
  type CurrencyCode,
  type FashionSubtype,
  type Locale,
  type ShopProfile,
  type ShopSubtype,
  type StoreType,
  type UUID,
} from '../types';
import { defaultLocationLabels } from '../db/migrate-v8-to-v9';
import { nowISO } from '../utils/now';

export const DEFAULT_CURRENCY: CurrencyCode = 'TND';
// v0.5.2 ADR-021: 'fashion' replaces the legacy 'shoes' default. New
// profiles created via the API without an explicit store_type land on
// fashion; onboarding always passes one explicitly.
export const DEFAULT_STORE_TYPE: StoreType = 'fashion';
export const DEFAULT_EXPIRY_WARNING_DAYS = 7;

// SPEC §2.1 onboarding produces exactly one ShopProfile row, primary key
// is the literal string "singleton" (DATA_MODEL §2). We never insert a
// second row.

const SINGLETON_ID = 'singleton' as const;

export async function getProfile(db: InventarDB): Promise<ShopProfile | undefined> {
  return db.profile.get(SINGLETON_ID);
}

export interface UpsertProfileInput {
  name: string;
  locale: Locale;
  // Optional: when omitted, the existing logo (if any) is preserved. Pass
  // `null` explicitly to clear, or a UUID to set/replace.
  logo_photo_id?: UUID | null;
  // Optional: when omitted, the existing currency is preserved (or
  // DEFAULT_CURRENCY for first-time creation).
  currency?: CurrencyCode;
  // Optional: when omitted, the existing store_type is preserved (or
  // DEFAULT_STORE_TYPE for first-time creation).
  store_type?: StoreType;
  // v0.5 ADR-017: shop sub-categorisation. Only meaningful when
  // store_type is 'shop'. When omitted, the existing value is preserved
  // (or [] for first-time creation). The onboarding shop-subtypes step
  // validates ≥1 selection before calling this.
  shop_subtypes?: ShopSubtype[];
  // v0.5.2 ADR-021: fashion-vertical analogue of shop_subtypes. Only
  // meaningful when store_type is 'fashion'. Preserved on omit, [] on
  // first-time creation.
  fashion_subtypes?: FashionSubtype[];
  // v0.5.2 ADR-022: per-vertical merchant-customisable location labels.
  // When omitted, defaults are derived from store_type + locale via
  // defaultLocationLabels(); when explicitly set, the merchant's
  // string is stored verbatim and survives subsequent locale changes.
  location_floor_label?: string;
  location_back_label?: string;
  // v0.5.2 ADR-023: global expiry warning threshold in days. Default
  // 7 at first-create; preserved across subsequent upserts when omitted.
  expiry_warning_days?: number;
  // v0.5.2.4 ADR-024 — invoicing / Facture fiscal block. All four
  // are nullable; passing `null` clears the field, omitting preserves
  // the existing value, passing a string/number sets it. Default at
  // first-create is null for every field — Settings → Invoicing is
  // where the merchant fills them in.
  legal_name?: string | null;
  legal_address?: string | null;
  fiscal_id?: string | null;
  default_vat_pct?: number | null;
}

// Creates the profile on first call (sets created_at = now), updates it on
// subsequent calls (preserves created_at, refreshes updated_at).
//
// Logo lifecycle: when logo_photo_id changes (replaced or cleared), the
// previous Photo row is hard-deleted to avoid orphaned blobs. A profile
// only ever has one logo, so soft-delete adds no value here.
export async function upsertProfile(
  db: InventarDB,
  input: UpsertProfileInput,
): Promise<ShopProfile> {
  const ts = nowISO();
  return db.transaction('rw', db.profile, db.photos, async () => {
    const existing = await db.profile.get(SINGLETON_ID);
    const nextLogo =
      input.logo_photo_id === undefined ? (existing?.logo_photo_id ?? null) : input.logo_photo_id;
    if (existing && existing.logo_photo_id && existing.logo_photo_id !== nextLogo) {
      await db.photos.delete(existing.logo_photo_id);
    }
    const nextStoreType = input.store_type ?? existing?.store_type ?? DEFAULT_STORE_TYPE;
    // For label defaults: fashion (and the legacy shoes/clothes which
    // map to it) get fashion-vertical labels; everything else (i.e.
    // shop) gets shop-vertical labels.
    const verticalForLabels: 'fashion' | 'shop' = nextStoreType === 'shop' ? 'shop' : 'fashion';
    const labelDefaults = defaultLocationLabels(verticalForLabels, input.locale);
    const next: ShopProfile = {
      id: SINGLETON_ID,
      name: input.name,
      locale: input.locale,
      logo_photo_id: nextLogo,
      currency: input.currency ?? existing?.currency ?? DEFAULT_CURRENCY,
      store_type: nextStoreType,
      shop_subtypes: input.shop_subtypes ?? existing?.shop_subtypes ?? [],
      fashion_subtypes: input.fashion_subtypes ?? existing?.fashion_subtypes ?? [],
      location_floor_label:
        input.location_floor_label ?? existing?.location_floor_label ?? labelDefaults.floor,
      location_back_label:
        input.location_back_label ?? existing?.location_back_label ?? labelDefaults.back,
      expiry_warning_days:
        input.expiry_warning_days ?? existing?.expiry_warning_days ?? DEFAULT_EXPIRY_WARNING_DAYS,
      legal_name:
        input.legal_name === undefined ? (existing?.legal_name ?? null) : input.legal_name,
      legal_address:
        input.legal_address === undefined ? (existing?.legal_address ?? null) : input.legal_address,
      fiscal_id: input.fiscal_id === undefined ? (existing?.fiscal_id ?? null) : input.fiscal_id,
      default_vat_pct:
        input.default_vat_pct === undefined
          ? (existing?.default_vat_pct ?? null)
          : input.default_vat_pct,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
      last_backup_at: existing?.last_backup_at ?? null,
    };
    await db.profile.put(next);
    return next;
  });
}

// ADR-009: Settings → Export Data calls this after a successful share so
// the home-screen banner stops nagging until the next 7-day window.
export async function markBackedUp(db: InventarDB): Promise<void> {
  const ts = nowISO();
  await db.transaction('rw', db.profile, async () => {
    const existing = await db.profile.get(SINGLETON_ID);
    if (!existing) {
      throw new Error('Cannot mark backup before profile exists');
    }
    await db.profile.put({ ...existing, last_backup_at: ts, updated_at: ts });
  });
}
