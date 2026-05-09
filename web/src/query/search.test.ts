import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import { archiveArticle, createArticle } from '../repos/articles';
import { recordMovement } from '../repos/movements';
import { searchArticles } from './search';

interface Spec {
  name: string;
  colors: string[];
  sizes: Array<{ size: string; qty: number }>;
}

async function seedArticle(db: InventarDB, spec: Spec): Promise<string> {
  const created = await createArticle(db, {
    name: spec.name,
    photo_id: null,
    category: 'sport',
    colors: spec.colors,
    brand: null,
    cost_price_tnd: 30000,
    sale_price_tnd: 60000,
    notes: null,
    sizes: spec.sizes.map(({ size, qty }) => ({ size, initial_qty: qty })),
  });
  return created.article.id;
}

describe('searchArticles — trilingual normalisation (SPEC §1.4 / §2.2)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    db = new InventarDB();
    await db.open();
    await seedArticle(db, {
      name: 'White running shoe',
      colors: ['white'],
      sizes: [
        { size: '40', qty: 1 },
        { size: '42', qty: 2 },
      ],
    });
    await seedArticle(db, {
      name: 'Brown leather boot',
      colors: ['brown'],
      sizes: [{ size: '40', qty: 1 }],
    });
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
  });

  it.each([
    ['white 42', 'White running shoe'],
    ['WHITE 42', 'White running shoe'],
    ['white  42', 'White running shoe'],
    ['blanc 42', 'White running shoe'],
    ['أبيض ٤٢', 'White running shoe'],
  ])('query %j finds %j', async (query, expectedName) => {
    const results = await searchArticles(query, {}, db);
    expect(results.map((r) => r.article.name)).toContain(expectedName);
    const top = results[0];
    expect(top?.article.name).toBe(expectedName);
    expect(top?.matchedSize).toBe('42');
  });

  it('ranks in-stock-exact above out-of-stock-exact', async () => {
    const ids = await db.articles.toArray();
    const white = ids.find((a) => a.name === 'White running shoe')!;
    // Drain size 40 to zero so the same query "white 40" goes to tier 2.
    const v40 = await db.variants.where('[article_id+size]').equals([white.id, '40']).first();
    await recordMovement(db, {
      variant_id: v40!.id,
      delta: -1,
      type: 'sale',
      note: null,
      location: 'back',
    });

    const inStock = await searchArticles('white 42', {}, db);
    expect(inStock[0]?.matchedSize).toBe('42');

    const outOfStock = await searchArticles('white 40', {}, db);
    expect(outOfStock[0]?.matchedSize).toBe('40');
    expect(outOfStock[0]?.sizeStock.find((s) => s.size === '40')?.qty).toBe(0);
  });

  it('places archived articles last', async () => {
    const ids = await db.articles.toArray();
    const brown = ids.find((a) => a.name === 'Brown leather boot')!;
    await archiveArticle(db, brown.id);

    const all = await searchArticles('40', { includeArchived: true }, db);
    const archivedIdx = all.findIndex((r) => r.article.name === 'Brown leather boot');
    expect(archivedIdx).toBe(all.length - 1);
  });

  it('hides archived by default', async () => {
    const ids = await db.articles.toArray();
    const brown = ids.find((a) => a.name === 'Brown leather boot')!;
    await archiveArticle(db, brown.id);
    const r = await searchArticles('brown', {}, db);
    expect(r.map((x) => x.article.name)).not.toContain('Brown leather boot');
  });

  it('filters by every general token (AND, not OR)', async () => {
    await seedArticle(db, {
      name: 'White summer sandal',
      colors: ['white'],
      sizes: [{ size: '40', qty: 1 }],
    });
    const r = await searchArticles('white running', {}, db);
    expect(r.map((x) => x.article.name)).toEqual(['White running shoe']);
  });

  it('returns nothing for a query whose general tokens do not match', async () => {
    const r = await searchArticles('purple', {}, db);
    expect(r).toEqual([]);
  });

  it('returns all candidates (sorted) for an empty query', async () => {
    const r = await searchArticles('', {}, db);
    expect(r.map((x) => x.article.name).sort()).toEqual([
      'Brown leather boot',
      'White running shoe',
    ]);
  });
});
