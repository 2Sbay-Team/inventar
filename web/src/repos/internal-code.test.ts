import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { nextInternalCode } from './internal-code';
import type { Article } from '../types';

const NOW = '2026-05-07T00:00:00.000Z';

function mkArticle(overrides: Partial<Article> & Pick<Article, 'id' | 'internal_code'>): Article {
  return {
    name: 'x',
    photo_id: null,
    category: 'sport',
    colors: [],
    brand: null,
    cost_price_tnd: 0,
    sale_price_tnd: 0,
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

describe('nextInternalCode', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it('returns SH-0001 for an empty catalogue', async () => {
    expect(await nextInternalCode(db)).toBe('SH-0001');
  });

  it('increments from the lexicographic max, zero-padded to 4 digits', async () => {
    await db.articles.bulkAdd([
      mkArticle({ id: 'a', internal_code: 'SH-0001' }),
      mkArticle({ id: 'b', internal_code: 'SH-0009' }),
      mkArticle({ id: 'c', internal_code: 'SH-0007' }),
    ]);
    expect(await nextInternalCode(db)).toBe('SH-0010');
  });

  it('does not reuse codes from archived articles (DATA_MODEL §4)', async () => {
    await db.articles.bulkAdd([mkArticle({ id: 'a', internal_code: 'SH-0042', archived_at: NOW })]);
    expect(await nextInternalCode(db)).toBe('SH-0043');
  });

  it('does not reuse codes from soft-deleted articles (DATA_MODEL §4)', async () => {
    await db.articles.bulkAdd([mkArticle({ id: 'a', internal_code: 'SH-0042', deleted_at: NOW })]);
    expect(await nextInternalCode(db)).toBe('SH-0043');
  });

  it('crosses the four-digit boundary', async () => {
    await db.articles.add(mkArticle({ id: 'a', internal_code: 'SH-9999' }));
    expect(await nextInternalCode(db)).toBe('SH-10000');
  });

  it('uses the requested prefix on an empty catalogue', async () => {
    expect(await nextInternalCode(db, 'KI')).toBe('KI-0001');
    expect(await nextInternalCode(db, 'GR')).toBe('GR-0001');
  });

  it('continues numbering across mixed prefixes (post store-type switch)', async () => {
    // Simulates a shop that started as shoes (SH-0001..SH-0003) and
    // switched to clothes — the next clothes code should be CL-0004,
    // not CL-0001, because it builds on the global numeric max.
    await db.articles.bulkAdd([
      mkArticle({ id: 'a', internal_code: 'SH-0001' }),
      mkArticle({ id: 'b', internal_code: 'SH-0003' }),
    ]);
    expect(await nextInternalCode(db, 'CL')).toBe('CL-0004');
  });
});
