import { type InventarDB } from '../db/db';
import {
  type CurrencyCode,
  type FashionSubtype,
  type Locale,
  type OpeningHours,
  type QrCenterMode,
  type ShopProfile,
  type ShopSubtype,
  type SizeStandard,
  type StoreType,
  type ThemeMode,
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
// Default size-numbering standard for new profiles. EU covers Tunisia,
// France, and most of the EMEA region the app ships to; merchants can
// switch in Settings → Store.
export const DEFAULT_SIZE_STANDARD: SizeStandard = 'EU';

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
  // Size-numbering standard for sized articles. Preserved on omit;
  // defaults to DEFAULT_SIZE_STANDARD ('EU') on first create.
  size_standard?: SizeStandard;
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
  // v0.5.2.7 — merchant phone for invoice header. Same semantics as
  // the other invoicing fields: undefined preserves, null clears.
  phone?: string | null;
  // v0.6.5 — printed-QR-label centre. Undefined preserves the existing
  // value (or seeds based on logo presence on first create). Explicit
  // 'logo' is overridden to 'name' at write time when no logo is set
  // — guarantees the renderer never sees ('logo', null) as a paired
  // state, so it doesn't need its own fallback logic.
  qr_center_mode?: QrCenterMode;
  // v0.9 ADR-039 / ADR-040 — Shop Identity expansion. Every field
  // follows the standard repo convention: omit to preserve, pass
  // `null` to clear, pass a value to set. theme_mode is the only
  // non-nullable new field — omit preserves, an explicit value sets.
  tagline?: string | null;
  description?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  brand_primary_color?: string | null;
  theme_bg_color?: string | null;
  theme_mode?: ThemeMode;
  logo_dominant_color?: string | null;
  opening_hours?: OpeningHours | null;
  scan_qr_opens_sell?: boolean | null;
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
      size_standard: input.size_standard ?? existing?.size_standard ?? DEFAULT_SIZE_STANDARD,
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
      phone: input.phone === undefined ? (existing?.phone ?? null) : input.phone,
      qr_center_mode: deriveQrCenterMode(
        input.qr_center_mode,
        existing?.qr_center_mode,
        existing?.logo_photo_id ?? null,
        nextLogo,
      ),
      tagline: input.tagline === undefined ? (existing?.tagline ?? null) : input.tagline,
      description:
        input.description === undefined ? (existing?.description ?? null) : input.description,
      address_street:
        input.address_street === undefined
          ? (existing?.address_street ?? null)
          : input.address_street,
      address_city:
        input.address_city === undefined ? (existing?.address_city ?? null) : input.address_city,
      address_country:
        input.address_country === undefined
          ? (existing?.address_country ?? null)
          : input.address_country,
      whatsapp: input.whatsapp === undefined ? (existing?.whatsapp ?? null) : input.whatsapp,
      email: input.email === undefined ? (existing?.email ?? null) : input.email,
      website: input.website === undefined ? (existing?.website ?? null) : input.website,
      instagram: input.instagram === undefined ? (existing?.instagram ?? null) : input.instagram,
      facebook: input.facebook === undefined ? (existing?.facebook ?? null) : input.facebook,
      tiktok: input.tiktok === undefined ? (existing?.tiktok ?? null) : input.tiktok,
      brand_primary_color:
        input.brand_primary_color === undefined
          ? (existing?.brand_primary_color ?? null)
          : input.brand_primary_color,
      theme_bg_color:
        input.theme_bg_color === undefined
          ? (existing?.theme_bg_color ?? null)
          : input.theme_bg_color,
      theme_mode: input.theme_mode ?? existing?.theme_mode ?? 'light',
      logo_dominant_color:
        input.logo_dominant_color === undefined
          ? (existing?.logo_dominant_color ?? null)
          : input.logo_dominant_color,
      opening_hours:
        input.opening_hours === undefined ? (existing?.opening_hours ?? null) : input.opening_hours,
      scan_qr_opens_sell:
        input.scan_qr_opens_sell === undefined
          ? (existing?.scan_qr_opens_sell ?? null)
          : input.scan_qr_opens_sell,
      created_at: existing?.created_at ?? ts,
      updated_at: ts,
      last_backup_at: existing?.last_backup_at ?? null,
    };
    await db.profile.put(next);
    return next;
  });
}

// v0.6.5 — resolve the next qr_center_mode given the caller's input,
// the existing stored value, and the logo transition for this
// write. Three load-bearing behaviours:
//
//   1. Caller-supplied input wins, except 'logo' with no logo → 'name'
//      (auto-fallback so the renderer never sees an unrenderable pair).
//   2. Existing 'logo' with no logo now → 'name' (auto-fallback applied
//      to the existing-row case so the renderer doesn't have to).
//   3. Existing 'name' AND previously no logo AND now has logo → 'logo'
//      (auto-promote on first-logo upload — the brief's "Default: 'logo'
//      if logo exists" rule applied at the moment the logo appears).
//      Replacing one logo with another preserves the existing choice
//      so a merchant who explicitly picked 'name' isn't reset.
//   4. No input, no existing: first-create default — 'logo' if logo,
//      else 'name'.
export function deriveQrCenterMode(
  input: QrCenterMode | undefined,
  existing: QrCenterMode | undefined,
  existingLogo: UUID | null | undefined,
  nextLogo: UUID | null,
): QrCenterMode {
  if (input !== undefined) return input === 'logo' && !nextLogo ? 'name' : input;
  if (existing === 'name' && !existingLogo && nextLogo) return 'logo';
  if (existing !== undefined) return existing === 'logo' && !nextLogo ? 'name' : existing;
  return nextLogo ? 'logo' : 'name';
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
