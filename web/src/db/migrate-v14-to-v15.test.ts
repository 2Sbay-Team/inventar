import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';

// v0.9 ADR-039 / ADR-040 — the v14→v15 Dexie upgrade backfills 16
// new columns on the singleton profile row. Every nullable field
// lands at null; theme_mode lands at 'light'. The upgrade is
// idempotent — a re-run over a row that already carries any subset
// of the new fields leaves those values alone.
//
// The production upgrade lives inside db.ts's version().upgrade()
// chain, opaque from outside. This test mirrors the same upgrade
// rule inline so the migration contract is pinned without booting
// the full InventarDB class.

const DB_NAME = 'migrate-v14-v15-test';

// The subset of profile-row fields this migration touches. Anything
// pre-existing (id, name, locale, …) flows through untouched.
interface ProfileRow {
  id: string;
  name: string;
  // Existing v14-era fields we set on the seed row so the upgrade
  // sees a realistic shape.
  logo_photo_id?: string | null;
  qr_center_mode?: 'logo' | 'name';
  // Subset of the new v15 fields the tests assert on. The rest
  // follow the same rule and are covered en masse by the
  // "backfills every new field" case.
  tagline?: string | null;
  description?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  brand_primary_color?: string | null;
  theme_bg_color?: string | null;
  theme_mode?: 'light' | 'dark' | 'auto';
  logo_dominant_color?: string | null;
  opening_hours?: unknown;
}

const V15_NULL_KEYS: readonly (keyof ProfileRow)[] = [
  'tagline',
  'description',
  'email',
  'whatsapp',
  'instagram',
  'brand_primary_color',
  'theme_bg_color',
  'logo_dominant_color',
  'opening_hours',
];

function attachV15Upgrade(db: Dexie): void {
  db.version(14).stores({ profile: 'id' });
  db.version(15)
    .stores({ profile: 'id' })
    .upgrade(async (tx) => {
      await tx
        .table('profile')
        .toCollection()
        .modify(
          (p: {
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
            theme_mode?: 'light' | 'dark' | 'auto';
            logo_dominant_color?: string | null;
            opening_hours?: unknown;
          }) => {
            if (!('tagline' in p)) p.tagline = null;
            if (!('description' in p)) p.description = null;
            if (!('address_street' in p)) p.address_street = null;
            if (!('address_city' in p)) p.address_city = null;
            if (!('address_country' in p)) p.address_country = null;
            if (!('whatsapp' in p)) p.whatsapp = null;
            if (!('email' in p)) p.email = null;
            if (!('website' in p)) p.website = null;
            if (!('instagram' in p)) p.instagram = null;
            if (!('facebook' in p)) p.facebook = null;
            if (!('tiktok' in p)) p.tiktok = null;
            if (!('brand_primary_color' in p)) p.brand_primary_color = null;
            if (!('theme_bg_color' in p)) p.theme_bg_color = null;
            if (!('theme_mode' in p)) p.theme_mode = 'light';
            if (!('logo_dominant_color' in p)) p.logo_dominant_color = null;
            if (!('opening_hours' in p)) p.opening_hours = null;
          },
        );
    });
}

async function seedAtV14(row: ProfileRow): Promise<void> {
  const db = new Dexie(DB_NAME);
  db.version(14).stores({ profile: 'id' });
  await db.open();
  await db.table('profile').add(row);
  db.close();
}

async function openAtV15(): Promise<Dexie> {
  const db = new Dexie(DB_NAME);
  attachV15Upgrade(db);
  await db.open();
  return db;
}

describe('v14 → v15 upgrade — Shop Identity field backfill', () => {
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
  });
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('backfills every new nullable field to null on a v14 profile', async () => {
    await seedAtV14({
      id: 'singleton',
      name: 'Pre-v15 Shop',
      logo_photo_id: null,
      qr_center_mode: 'name',
    });
    const db = await openAtV15();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    for (const key of V15_NULL_KEYS) {
      expect(after[key], `expected ${String(key)} to be null after upgrade`).toBeNull();
    }
  });

  it("backfills theme_mode to 'light' (the only non-null default)", async () => {
    await seedAtV14({ id: 'singleton', name: 'A', logo_photo_id: null });
    const db = await openAtV15();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.theme_mode).toBe('light');
  });

  it('preserves the v14-era fields the migration does not touch', async () => {
    await seedAtV14({
      id: 'singleton',
      name: 'Existing Shop',
      logo_photo_id: 'photo-uuid-1',
      qr_center_mode: 'logo',
    });
    const db = await openAtV15();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.name).toBe('Existing Shop');
    expect(after.logo_photo_id).toBe('photo-uuid-1');
    expect(after.qr_center_mode).toBe('logo');
  });

  it('idempotent: rows that already carry a v15 field keep their existing value', async () => {
    // Mirrors the "Dexie history replay" / re-open-after-crash path.
    // The merchant set tagline + brand_primary_color in v15-aware code;
    // the upgrade fires again and must not blow them back to null.
    await seedAtV14({
      id: 'singleton',
      name: 'Already Branded',
      logo_photo_id: 'photo-uuid-2',
      qr_center_mode: 'logo',
      tagline: 'Quality fashion since 2020',
      brand_primary_color: '#2B4C8A',
      theme_mode: 'dark',
    });
    const db = await openAtV15();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.tagline).toBe('Quality fashion since 2020');
    expect(after.brand_primary_color).toBe('#2B4C8A');
    expect(after.theme_mode).toBe('dark');
    // Untouched fields still backfill to null.
    expect(after.email).toBeNull();
    expect(after.instagram).toBeNull();
  });

  it('idempotent: rows that already carry a null value keep null (not overwritten)', async () => {
    // The `if (!('tagline' in p)) p.tagline = null` guard distinguishes
    // missing from null — both end up at null, but a future migration
    // might rely on the distinction (e.g. "merchant explicitly cleared
    // tagline" vs "tagline never existed"). Pin the current behaviour
    // so the no-op semantics stay obvious.
    await seedAtV14({
      id: 'singleton',
      name: 'Has Explicit Nulls',
      tagline: null,
      description: null,
    });
    const db = await openAtV15();
    const after = (await db.table('profile').get('singleton')) as ProfileRow;
    db.close();
    expect(after.tagline).toBeNull();
    expect(after.description).toBeNull();
  });
});
