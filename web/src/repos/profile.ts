import { type InventarDB } from '../db/db';
import {
  type CurrencyCode,
  type Locale,
  type ShopProfile,
  type ShopSubtype,
  type StoreType,
  type UUID,
} from '../types';
import { nowISO } from '../utils/now';

export const DEFAULT_CURRENCY: CurrencyCode = 'TND';
export const DEFAULT_STORE_TYPE: StoreType = 'shoes';

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
    const next: ShopProfile = {
      id: SINGLETON_ID,
      name: input.name,
      locale: input.locale,
      logo_photo_id: nextLogo,
      currency: input.currency ?? existing?.currency ?? DEFAULT_CURRENCY,
      store_type: input.store_type ?? existing?.store_type ?? DEFAULT_STORE_TYPE,
      shop_subtypes: input.shop_subtypes ?? existing?.shop_subtypes ?? [],
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
