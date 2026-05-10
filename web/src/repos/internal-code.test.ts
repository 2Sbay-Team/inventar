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
    expiry_alert_days: null,
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

  it('per-prefix counter: switching prefix starts a fresh sequence at -0001', async () => {
    // v0.5.2 ADR-024: each prefix is independent. A shop that started as
    // shoes (SH-0001..SH-0003) and switched to fashion gets FN-0001 as
    // the first fashion code — NOT FN-0004 (which was the pre-v0.5.2
    // global-counter behaviour and confused merchants).
    await db.articles.bulkAdd([
      mkArticle({ id: 'a', internal_code: 'SH-0001' }),
      mkArticle({ id: 'b', internal_code: 'SH-0003' }),
    ]);
    expect(await nextInternalCode(db, 'FN')).toBe('FN-0001');
    expect(await nextInternalCode(db, 'SP')).toBe('SP-0001');
    // The legacy prefix is unaffected — still SH-0004 if anyone asks.
    expect(await nextInternalCode(db, 'SH')).toBe('SH-0004');
  });

  it('per-prefix counter: legacy and new prefixes coexist without bleeding', async () => {
    // The realistic post-migration shape: a profile with a few SH-* and
    // CL-* articles from before the merge plus a couple of FN-* added
    // after migration. Asking for the next FN respects only FN-* tails.
    await db.articles.bulkAdd([
      mkArticle({ id: 'a', internal_code: 'SH-0042' }),
      mkArticle({ id: 'b', internal_code: 'CL-0017' }),
      mkArticle({ id: 'c', internal_code: 'FN-0001' }),
      mkArticle({ id: 'd', internal_code: 'FN-0002' }),
    ]);
    expect(await nextInternalCode(db, 'FN')).toBe('FN-0003');
    expect(await nextInternalCode(db, 'SP')).toBe('SP-0001');
  });

  it('per-prefix counter: ignores prefix lookalikes (SHX-, SH2-, longer prefixes)', async () => {
    // tailNumber's startsWith guard MUST require the exact `${prefix}-`
    // boundary, otherwise "SHX-0050" would bleed into the SH counter.
    await db.articles.bulkAdd([
      mkArticle({ id: 'a', internal_code: 'SHX-0050' }),
      mkArticle({ id: 'b', internal_code: 'SH2-0099' }),
    ]);
    expect(await nextInternalCode(db, 'SH')).toBe('SH-0001');
  });
});
