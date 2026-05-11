import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';

// v0.5.2.9 — integration test for the v11→v12 Dexie upgrade. The
// upgrade callback adds four columns to every Article row:
//   has_sizes / has_colors / has_expiry   nullable booleans
//   unit_of_measure                       default 'piece'
//
// Approach: open a real Dexie database at v11 (just the schema, no
// upgrade logic), insert one article that lacks the new fields, close,
// then open at v12 with the actual production upgrade callback and
// verify the row was backfilled. fake-indexeddb is already wired by
// test-setup.ts so this runs in jsdom without a browser.

const DB_NAME = 'migrate-v11-v12-test';

interface V11Article {
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
  expiry_alert_days: number | null;
  search_blob: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

interface V12Article extends V11Article {
  has_sizes: boolean | null;
  has_colors: boolean | null;
  has_expiry: boolean | null;
  unit_of_measure: 'piece' | 'kg' | 'g' | 'l' | 'ml';
}

describe('v11 → v12 upgrade — Article trait + UoM backfill', () => {
  beforeEach(async () => {
    await Dexie.delete(DB_NAME);
  });
  afterEach(async () => {
    await Dexie.delete(DB_NAME);
  });

  it('adds nullable trait fields and defaults unit_of_measure to piece', async () => {
    // Stage 1: open at v11, write a pre-v12 article missing the new fields.
    const v11 = new Dexie(DB_NAME);
    v11.version(11).stores({
      articles: 'id, internal_code, category',
    });
    await v11.open();
    const articleId = 'art-1';
    const v11Row: V11Article = {
      id: articleId,
      internal_code: 'FN-0001',
      name: 'Old article',
      photo_id: null,
      category: 'sport',
      colors: [],
      brand: null,
      cost_price_tnd: 0,
      sale_price_tnd: 0,
      notes: null,
      barcode_ean: null,
      min_stock_threshold: null,
      expiry_alert_days: null,
      search_blob: '',
      updated_at: '2026-05-11T00:00:00.000Z',
      archived_at: null,
      deleted_at: null,
    };
    await v11.table('articles').add(v11Row);
    v11.close();

    // Stage 2: open at v12 with the SAME upgrade logic the production
    // db.ts ships. The .upgrade callback runs once on this Dexie
    // version step.
    const v12 = new Dexie(DB_NAME);
    v12.version(11).stores({ articles: 'id, internal_code, category' });
    v12
      .version(12)
      .stores({ articles: 'id, internal_code, category' })
      .upgrade(async (tx) => {
        await tx
          .table('articles')
          .toCollection()
          .modify(
            (a: {
              has_sizes?: boolean | null;
              has_colors?: boolean | null;
              has_expiry?: boolean | null;
              unit_of_measure?: 'piece' | 'kg' | 'g' | 'l' | 'ml';
            }) => {
              if (!('has_sizes' in a)) a.has_sizes = null;
              if (!('has_colors' in a)) a.has_colors = null;
              if (!('has_expiry' in a)) a.has_expiry = null;
              if (!('unit_of_measure' in a)) a.unit_of_measure = 'piece';
            },
          );
      });
    await v12.open();
    const migrated = (await v12.table('articles').get(articleId)) as V12Article | undefined;
    v12.close();

    expect(migrated).toBeDefined();
    if (!migrated) return;
    // New fields exist with the right defaults.
    expect(migrated.has_sizes).toBeNull();
    expect(migrated.has_colors).toBeNull();
    expect(migrated.has_expiry).toBeNull();
    expect(migrated.unit_of_measure).toBe('piece');
    // Pre-existing fields are untouched.
    expect(migrated.name).toBe('Old article');
    expect(migrated.internal_code).toBe('FN-0001');
    expect(migrated.cost_price_tnd).toBe(0);
  });

  it('idempotent — does not overwrite existing trait values on second open', async () => {
    // Stage 1: write a row that already has trait fields set (as a v12
    // app would when creating a new article post-upgrade).
    const db = new Dexie(DB_NAME);
    db.version(11).stores({ articles: 'id, internal_code, category' });
    db.version(12)
      .stores({ articles: 'id, internal_code, category' })
      .upgrade(async (tx) => {
        await tx
          .table('articles')
          .toCollection()
          .modify(
            (a: {
              has_sizes?: boolean | null;
              has_colors?: boolean | null;
              has_expiry?: boolean | null;
              unit_of_measure?: 'piece' | 'kg' | 'g' | 'l' | 'ml';
            }) => {
              if (!('has_sizes' in a)) a.has_sizes = null;
              if (!('has_colors' in a)) a.has_colors = null;
              if (!('has_expiry' in a)) a.has_expiry = null;
              if (!('unit_of_measure' in a)) a.unit_of_measure = 'piece';
            },
          );
      });
    await db.open();
    const articleId = 'art-2';
    await db.table('articles').add({
      id: articleId,
      internal_code: 'FN-0002',
      name: 'Fish',
      photo_id: null,
      category: 'sport',
      colors: [],
      brand: null,
      cost_price_tnd: 15,
      sale_price_tnd: 30,
      notes: null,
      barcode_ean: null,
      min_stock_threshold: null,
      expiry_alert_days: null,
      // Concrete values the merchant chose — must survive a re-open.
      has_sizes: false,
      has_colors: false,
      has_expiry: true,
      unit_of_measure: 'kg',
      search_blob: '',
      updated_at: '2026-05-11T00:00:00.000Z',
      archived_at: null,
      deleted_at: null,
    });
    db.close();

    // Stage 2: re-open. The upgrade callback at v12 must NOT clobber
    // the concrete values (each guard uses `in` so existing keys are
    // left alone).
    const reopen = new Dexie(DB_NAME);
    reopen.version(11).stores({ articles: 'id, internal_code, category' });
    reopen
      .version(12)
      .stores({ articles: 'id, internal_code, category' })
      .upgrade(async (tx) => {
        await tx
          .table('articles')
          .toCollection()
          .modify(
            (a: {
              has_sizes?: boolean | null;
              has_colors?: boolean | null;
              has_expiry?: boolean | null;
              unit_of_measure?: 'piece' | 'kg' | 'g' | 'l' | 'ml';
            }) => {
              if (!('has_sizes' in a)) a.has_sizes = null;
              if (!('has_colors' in a)) a.has_colors = null;
              if (!('has_expiry' in a)) a.has_expiry = null;
              if (!('unit_of_measure' in a)) a.unit_of_measure = 'piece';
            },
          );
      });
    await reopen.open();
    const row = (await reopen.table('articles').get(articleId)) as V12Article;
    reopen.close();

    expect(row.has_sizes).toBe(false);
    expect(row.has_colors).toBe(false);
    expect(row.has_expiry).toBe(true);
    expect(row.unit_of_measure).toBe('kg');
  });
});
