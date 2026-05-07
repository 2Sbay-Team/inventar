import { type InventarDB } from '../db/db';
import { type Locale, type ShopProfile } from '../types';
import { nowISO } from '../utils/now';

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
}

// Creates the profile on first call (sets created_at = now), updates it on
// subsequent calls (preserves created_at, refreshes updated_at).
export async function upsertProfile(
  db: InventarDB,
  input: UpsertProfileInput,
): Promise<ShopProfile> {
  const ts = nowISO();
  return db.transaction('rw', db.profile, async () => {
    const existing = await db.profile.get(SINGLETON_ID);
    const next: ShopProfile = {
      id: SINGLETON_ID,
      name: input.name,
      locale: input.locale,
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
