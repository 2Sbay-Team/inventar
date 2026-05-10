import { describe, expect, it } from 'vitest';
import {
  defaultLocationLabels,
  migrateRowsV8ToV9,
  type V8Article,
  type V8ShopProfile,
} from './migrate-v8-to-v9';

const NOW = '2026-05-10T00:00:00.000Z';

function mkV8Profile(overrides: Partial<V8ShopProfile> = {}): V8ShopProfile {
  return {
    id: 'singleton',
    name: 'Test Shop',
    locale: 'en',
    logo_photo_id: null,
    currency: 'TND',
    store_type: 'shoes',
    shop_subtypes: [],
    created_at: NOW,
    updated_at: NOW,
    last_backup_at: null,
    ...overrides,
  };
}

function mkV8Article(
  overrides: Partial<V8Article> & Pick<V8Article, 'id' | 'internal_code'>,
): V8Article {
  return {
    name: 'Sample',
    photo_id: null,
    category: 'sport',
    colors: [],
    brand: null,
    cost_price_tnd: 1000,
    sale_price_tnd: 2000,
    notes: null,
    barcode_ean: null,
    min_stock_threshold: null,
    search_blob: '',
    updated_at: NOW,
    archived_at: null,
    deleted_at: null,
    ...overrides,
  };
}

describe('migrateRowsV8ToV9 — vertical consolidation', () => {
  it('shoes profile becomes fashion with fashion_subtypes=[shoes]', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shoes', locale: 'fr' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.store_type).toBe('fashion');
    expect(rows.profile?.fashion_subtypes).toEqual(['shoes']);
    expect(rows.profile?.shop_subtypes).toEqual([]);
  });

  it('clothes profile becomes fashion with fashion_subtypes=[clothing_men, clothing_women]', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'clothes', locale: 'ar' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.store_type).toBe('fashion');
    expect(rows.profile?.fashion_subtypes).toEqual(['clothing_men', 'clothing_women']);
  });

  it('shop profile preserves store_type, preserves shop_subtypes (incl. legacy keys)', () => {
    // ADR-021 ambiguity #4: legacy 'tobacco_lottery' / 'parapharmaceutique'
    // values must round-trip untouched so existing profiles don't lose
    // categorisation when the picker no longer offers them.
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({
        store_type: 'shop',
        shop_subtypes: ['food_beverages', 'tobacco_lottery', 'parapharmaceutique'],
        locale: 'en',
      }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.store_type).toBe('shop');
    expect(rows.profile?.shop_subtypes).toEqual([
      'food_beverages',
      'tobacco_lottery',
      'parapharmaceutique',
    ]);
    expect(rows.profile?.fashion_subtypes).toEqual([]);
  });

  it('already-fashion profile is idempotent (no fashion_subtypes overwrite)', () => {
    // An already-migrated row that the kernel sees again (e.g. on a
    // Dexie history replay). Its existing fashion_subtypes must NOT be
    // clobbered; the migration is supposed to be a no-op for these.
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({
        store_type: 'fashion',
        fashion_subtypes: ['accessories', 'jewelry'],
      }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.store_type).toBe('fashion');
    expect(rows.profile?.fashion_subtypes).toEqual(['accessories', 'jewelry']);
  });
});

describe('migrateRowsV8ToV9 — location labels (locale × vertical)', () => {
  it('shoes/fr → Boutique / Réserve', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shoes', locale: 'fr' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.location_floor_label).toBe('Boutique');
    expect(rows.profile?.location_back_label).toBe('Réserve');
  });

  it('clothes/ar → Arabic fashion labels', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'clothes', locale: 'ar' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.location_floor_label).toBe('المحل');
    expect(rows.profile?.location_back_label).toBe('المخزن');
  });

  it('shop/fr → Rayon / Réserve (different from fashion/fr)', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shop', locale: 'fr' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.location_floor_label).toBe('Rayon');
    expect(rows.profile?.location_back_label).toBe('Réserve');
  });

  it('preserves merchant-set non-empty labels (does NOT clobber a customised value)', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({
        store_type: 'shop',
        locale: 'fr',
        location_floor_label: 'Devant la caisse',
        location_back_label: '',
      }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    // Custom label survives; the empty back label gets replaced with the
    // locale default (the empty-string sentinel from the v6→v7 chained
    // pre-fill is treated as "needs filling in").
    expect(rows.profile?.location_floor_label).toBe('Devant la caisse');
    expect(rows.profile?.location_back_label).toBe('Réserve');
  });
});

describe('migrateRowsV8ToV9 — expiry_warning_days from meta', () => {
  it('copies the meta value when present', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shop' }),
      articles: [],
      expiryThresholdDaysMeta: 14,
    });
    expect(rows.profile?.expiry_warning_days).toBe(14);
  });

  it('defaults to 7 when meta is null', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shop' }),
      articles: [],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.profile?.expiry_warning_days).toBe(7);
  });

  it('preserves an existing v9 value over the meta value (idempotency)', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: mkV8Profile({ store_type: 'shop', expiry_warning_days: 30 }),
      articles: [],
      expiryThresholdDaysMeta: 7,
    });
    expect(rows.profile?.expiry_warning_days).toBe(30);
  });
});

describe('migrateRowsV8ToV9 — articles', () => {
  it('backfills expiry_alert_days=null on every article', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: null,
      articles: [
        mkV8Article({ id: 'a', internal_code: 'SH-0001' }),
        mkV8Article({ id: 'b', internal_code: 'GR-0007', barcode_ean: '5449000000996' }),
      ],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.articles).toHaveLength(2);
    expect(rows.articles[0]?.expiry_alert_days).toBeNull();
    expect(rows.articles[1]?.expiry_alert_days).toBeNull();
    // internal_code MUST be preserved (no SH→FN rewrite).
    expect(rows.articles[0]?.internal_code).toBe('SH-0001');
    expect(rows.articles[1]?.internal_code).toBe('GR-0007');
  });

  it('preserves an existing expiry_alert_days value (idempotency)', () => {
    const { rows } = migrateRowsV8ToV9({
      profile: null,
      articles: [
        mkV8Article({
          id: 'a',
          internal_code: 'SP-0001',
          expiry_alert_days: 3,
        }),
      ],
      expiryThresholdDaysMeta: null,
    });
    expect(rows.articles[0]?.expiry_alert_days).toBe(3);
  });
});

describe('defaultLocationLabels helper', () => {
  it('returns the right labels for every (vertical × locale) cell', () => {
    expect(defaultLocationLabels('fashion', 'en')).toEqual({
      floor: 'Shop floor',
      back: 'Stockroom',
    });
    expect(defaultLocationLabels('fashion', 'fr')).toEqual({
      floor: 'Boutique',
      back: 'Réserve',
    });
    expect(defaultLocationLabels('fashion', 'ar')).toEqual({
      floor: 'المحل',
      back: 'المخزن',
    });
    expect(defaultLocationLabels('shop', 'en')).toEqual({
      floor: 'Shelf',
      back: 'Stockroom',
    });
    expect(defaultLocationLabels('shop', 'fr')).toEqual({
      floor: 'Rayon',
      back: 'Réserve',
    });
    expect(defaultLocationLabels('shop', 'ar')).toEqual({
      floor: 'الرف',
      back: 'المخزن',
    });
  });
});
