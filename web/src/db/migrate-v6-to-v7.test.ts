import { describe, expect, it } from 'vitest';
import {
  migrateRowsV6ToV7,
  type V6Article,
  type V6Movement,
  type V6ShopProfile,
} from './migrate-v6-to-v7';

const NOW = '2026-05-09T12:00:00.000Z';

function mkProfile(overrides: Partial<V6ShopProfile>): V6ShopProfile {
  return {
    id: 'singleton',
    name: 'Test Shop',
    locale: 'fr',
    logo_photo_id: null,
    currency: 'TND',
    store_type: 'shoes',
    created_at: NOW,
    updated_at: NOW,
    last_backup_at: null,
    ...overrides,
  };
}

function mkArticle(o: Partial<V6Article> & Pick<V6Article, 'id' | 'name'>): V6Article {
  return {
    internal_code: 'X-0001',
    photo_id: null,
    category: 'other',
    colors: [],
    brand: null,
    cost_price_tnd: 1000,
    sale_price_tnd: 2000,
    notes: null,
    search_blob: '',
    updated_at: NOW,
    archived_at: null,
    deleted_at: null,
    ...o,
  };
}

function mkMovement(o: Partial<V6Movement> & Pick<V6Movement, 'id' | 'variant_id'>): V6Movement {
  return {
    delta: 1,
    type: 'purchase',
    note: null,
    unit_price_tnd: null,
    location: 'back',
    transfer_from: null,
    transfer_to: null,
    created_at: NOW,
    deleted_at: null,
    ...o,
  };
}

describe('migrateRowsV6ToV7 — profile mapping', () => {
  it('maps store_type=kiosk to shop with [tobacco_lottery, snacks_confectionery]', () => {
    const out = migrateRowsV6ToV7({
      profile: mkProfile({ store_type: 'kiosk' }),
      articles: [],
      movements: [],
    });
    expect(out.rows.profile?.store_type).toBe('shop');
    expect(out.rows.profile?.shop_subtypes).toEqual(['tobacco_lottery', 'snacks_confectionery']);
  });

  it('maps store_type=grocery to shop with [food_beverages]', () => {
    const out = migrateRowsV6ToV7({
      profile: mkProfile({ store_type: 'grocery' }),
      articles: [],
      movements: [],
    });
    expect(out.rows.profile?.store_type).toBe('shop');
    expect(out.rows.profile?.shop_subtypes).toEqual(['food_beverages']);
  });

  it('leaves shoes and clothes profiles untouched (with empty subtypes array)', () => {
    const shoes = migrateRowsV6ToV7({
      profile: mkProfile({ store_type: 'shoes', name: 'A Shoes' }),
      articles: [],
      movements: [],
    });
    expect(shoes.rows.profile?.store_type).toBe('shoes');
    expect(shoes.rows.profile?.shop_subtypes).toEqual([]);
    expect(shoes.rows.profile?.name).toBe('A Shoes');

    const clothes = migrateRowsV6ToV7({
      profile: mkProfile({ store_type: 'clothes' }),
      articles: [],
      movements: [],
    });
    expect(clothes.rows.profile?.store_type).toBe('clothes');
    expect(clothes.rows.profile?.shop_subtypes).toEqual([]);
  });

  it('is idempotent on a row already at v7 (re-run safety)', () => {
    const out = migrateRowsV6ToV7({
      profile: mkProfile({ store_type: 'shop' }),
      articles: [],
      movements: [],
    });
    expect(out.rows.profile?.store_type).toBe('shop');
    // Already-v7 rows without explicit subtypes default to [] — the
    // upgrade is happy to write an empty array; the merchant fills it
    // through onboarding.
    expect(out.rows.profile?.shop_subtypes).toEqual([]);
  });

  it('returns null profile when the input has no profile row', () => {
    const out = migrateRowsV6ToV7({ profile: null, articles: [], movements: [] });
    expect(out.rows.profile).toBeNull();
  });

  it('preserves every other profile field verbatim', () => {
    const original = mkProfile({
      store_type: 'kiosk',
      name: 'Carrefour City Test',
      locale: 'ar',
      logo_photo_id: 'logo-uuid',
      currency: 'EUR',
      last_backup_at: '2026-05-01T00:00:00.000Z',
    });
    const out = migrateRowsV6ToV7({ profile: original, articles: [], movements: [] });
    const p = out.rows.profile!;
    expect(p.name).toBe('Carrefour City Test');
    expect(p.locale).toBe('ar');
    expect(p.logo_photo_id).toBe('logo-uuid');
    expect(p.currency).toBe('EUR');
    expect(p.last_backup_at).toBe('2026-05-01T00:00:00.000Z');
    expect(p.created_at).toBe(NOW);
  });
});

describe('migrateRowsV6ToV7 — article + movement defaults', () => {
  it('defaults barcode_ean and min_stock_threshold to null on every article', () => {
    const out = migrateRowsV6ToV7({
      profile: null,
      articles: [
        mkArticle({ id: 'a-1', name: 'Spaghetti' }),
        mkArticle({ id: 'a-2', name: 'Coca-Cola' }),
      ],
      movements: [],
    });
    expect(out.rows.articles).toHaveLength(2);
    for (const a of out.rows.articles) {
      expect(a.barcode_ean).toBeNull();
      expect(a.min_stock_threshold).toBeNull();
    }
  });

  it('preserves every other article field verbatim', () => {
    const original = mkArticle({
      id: 'a-1',
      name: 'Spaghetti Barilla',
      internal_code: 'GR-0042',
      category: 'dry_goods',
      colors: ['white', 'red'], // legacy field — kept for v0.3 compat
      brand: 'Barilla',
      cost_price_tnd: 5500,
      sale_price_tnd: 7000,
      notes: 'house brand',
      archived_at: '2026-04-01T00:00:00.000Z',
    });
    const out = migrateRowsV6ToV7({ profile: null, articles: [original], movements: [] });
    const a = out.rows.articles[0]!;
    expect(a.id).toBe('a-1');
    expect(a.name).toBe('Spaghetti Barilla');
    expect(a.internal_code).toBe('GR-0042');
    expect(a.category).toBe('dry_goods');
    expect(a.colors).toEqual(['white', 'red']);
    expect(a.brand).toBe('Barilla');
    expect(a.cost_price_tnd).toBe(5500);
    expect(a.sale_price_tnd).toBe(7000);
    expect(a.notes).toBe('house brand');
    expect(a.archived_at).toBe('2026-04-01T00:00:00.000Z');
  });

  it('defaults transaction_id, expires_at, lot_id to null on every movement', () => {
    const out = migrateRowsV6ToV7({
      profile: null,
      articles: [],
      movements: [
        mkMovement({ id: 'm-1', variant_id: 'v-1', delta: 5, type: 'purchase' }),
        mkMovement({ id: 'm-2', variant_id: 'v-1', delta: -1, type: 'sale' }),
        mkMovement({ id: 'm-3', variant_id: 'v-1', delta: 1, type: 'transfer' }),
      ],
      movements_unused: undefined,
    } as never);
    expect(out.rows.movements).toHaveLength(3);
    for (const m of out.rows.movements) {
      expect(m.transaction_id).toBeNull();
      expect(m.expires_at).toBeNull();
      expect(m.lot_id).toBeNull();
    }
  });

  it('preserves every other movement field verbatim', () => {
    const original = mkMovement({
      id: 'm-1',
      variant_id: 'v-99',
      delta: -3,
      type: 'sale',
      note: 'discount sale',
      unit_price_tnd: 4500,
      location: 'floor',
    });
    const out = migrateRowsV6ToV7({ profile: null, articles: [], movements: [original] });
    const m = out.rows.movements[0]!;
    expect(m.id).toBe('m-1');
    expect(m.variant_id).toBe('v-99');
    expect(m.delta).toBe(-3);
    expect(m.type).toBe('sale');
    expect(m.note).toBe('discount sale');
    expect(m.unit_price_tnd).toBe(4500);
    expect(m.location).toBe('floor');
  });
});

describe("migrateRowsV6ToV7 — mixed-vertical fixture (the brief's ask)", () => {
  // Brief's required fixture: 2 kiosk articles + movements, 2 grocery
  // articles + movements, 1 shoes article. Assert the full multi-row
  // round-trip behaves correctly.
  const fixture = (): {
    profile: V6ShopProfile;
    articles: V6Article[];
    movements: V6Movement[];
  } => ({
    profile: mkProfile({ store_type: 'kiosk', name: 'Kiosk Joe' }),
    articles: [
      mkArticle({ id: 'k1', name: 'Cigarettes', internal_code: 'KI-0001', category: 'tobacco' }),
      mkArticle({ id: 'k2', name: 'Chocolate Bar', internal_code: 'KI-0002', category: 'snacks' }),
      mkArticle({ id: 'g1', name: 'Spaghetti', internal_code: 'GR-0001', category: 'dry_goods' }),
      mkArticle({ id: 'g2', name: 'Milk', internal_code: 'GR-0002', category: 'dairy' }),
      mkArticle({ id: 's1', name: 'Sneaker', internal_code: 'SH-0001', category: 'sport' }),
    ],
    movements: [
      mkMovement({ id: 'mk1', variant_id: 'k1-v', delta: 100, type: 'purchase' }),
      mkMovement({ id: 'mk2', variant_id: 'k1-v', delta: -3, type: 'sale' }),
      mkMovement({ id: 'mg1', variant_id: 'g1-v', delta: 50, type: 'purchase' }),
      mkMovement({ id: 'ms1', variant_id: 's1-v', delta: 10, type: 'purchase' }),
    ],
  });

  it('maps the kiosk profile to shop with the right subtypes', () => {
    const f = fixture();
    const out = migrateRowsV6ToV7(f);
    expect(out.rows.profile?.store_type).toBe('shop');
    expect(out.rows.profile?.shop_subtypes).toEqual(['tobacco_lottery', 'snacks_confectionery']);
  });

  it('preserves all 5 articles and stamps null defaults on the new fields', () => {
    const f = fixture();
    const out = migrateRowsV6ToV7(f);
    expect(out.rows.articles).toHaveLength(5);
    for (const a of out.rows.articles) {
      expect(a.barcode_ean).toBeNull();
      expect(a.min_stock_threshold).toBeNull();
    }
    // Internal codes are preserved untouched — KI-0001 stays KI-0001
    // even after the vertical merge. Only NEW shop articles get GR-NNNN.
    const codes = out.rows.articles.map((a) => a.internal_code).sort();
    expect(codes).toEqual(['GR-0001', 'GR-0002', 'KI-0001', 'KI-0002', 'SH-0001']);
  });

  it('preserves all 4 movements and stamps null on the three new fields', () => {
    const f = fixture();
    const out = migrateRowsV6ToV7(f);
    expect(out.rows.movements).toHaveLength(4);
    for (const m of out.rows.movements) {
      expect(m.transaction_id).toBeNull();
      expect(m.expires_at).toBeNull();
      expect(m.lot_id).toBeNull();
    }
    const ids = out.rows.movements.map((m) => m.id).sort();
    expect(ids).toEqual(['mg1', 'mk1', 'mk2', 'ms1']);
  });

  it('does not produce any Lot rows (fresh receiving sessions are the only source)', () => {
    // The kernel does not return a `lots` field — they are not derived
    // from legacy data. The DB upgrade callback in db.ts also does not
    // populate the lots table on migration, by design. This test guards
    // the contract.
    const f = fixture();
    const out = migrateRowsV6ToV7(f);
    expect(out.rows).not.toHaveProperty('lots');
  });
});
