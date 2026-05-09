import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import {
  archiveArticle,
  createArticle,
  getArticle,
  hardDeleteArticle,
  listArticles,
  unarchiveArticle,
  updateArticle,
} from './articles';
import { storePhoto } from './photos';

const NOW = '2026-05-07T00:00:00.000Z';

// Single-colour shape mirrors how add-article.tsx and most e2e callers
// invoke createArticle. The multi-colour cartesian behaviour gets its own
// test below.
const baseInput = {
  name: 'White running shoe',
  photo_id: null,
  category: 'sport' as const,
  colors: ['white'],
  brand: 'Nike',
  cost_price_tnd: 30000,
  sale_price_tnd: 60000,
  notes: null,
  sizes: [
    { size: '40', initial_qty: 2 },
    { size: '41', initial_qty: 1 },
  ],
};

describe('articles repo — createArticle', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('persists article + variants + initial purchase movements atomically', async () => {
    const { article, variants, movements } = await createArticle(db, baseInput);

    expect(article.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(article.internal_code).toBe('SH-0001');
    expect(article.updated_at).toBe(NOW);
    expect(article.archived_at).toBeNull();
    expect(article.deleted_at).toBeNull();

    expect(variants.length).toBe(2);
    expect(variants.every((v) => v.article_id === article.id)).toBe(true);

    expect(movements.length).toBe(2);
    expect(movements.every((m) => m.type === 'purchase')).toBe(true);
    expect(movements.map((m) => m.delta).sort()).toEqual([1, 2]);
  });

  it('lowercases colours before storing (search consistency with DATA_MODEL §5)', async () => {
    const { article } = await createArticle(db, { ...baseInput, colors: ['White', 'GRAY'] });
    expect(article.colors.sort()).toEqual(['gray', 'white']);
  });

  it('legacy multi-colour input fans out into a cartesian (colour × size) variant grid', async () => {
    const { variants, movements } = await createArticle(db, {
      ...baseInput,
      colors: ['white', 'gray'],
      sizes: [
        { size: '40', initial_qty: 2 },
        { size: '41', initial_qty: 1 },
      ],
    });
    // 2 colours × 2 sizes = 4 variants.
    expect(variants.length).toBe(4);
    const pairs = variants.map((v) => `${v.color}/${v.size}`).sort();
    expect(pairs).toEqual(['gray/40', 'gray/41', 'white/40', 'white/41']);
    // One initial purchase per non-zero seed quantity per variant; all
    // are booked to `back` so the floor stays empty until the merchant
    // moves stock out.
    expect(movements.length).toBe(4);
    expect(movements.every((m) => m.location === 'back')).toBe(true);
    expect(movements.map((m) => m.delta).sort()).toEqual([1, 1, 2, 2]);
  });

  it('post-v0.3 callers can pass an explicit variants[] for a known colour×size grid', async () => {
    const { variants, movements } = await createArticle(db, {
      name: 'Air Max',
      photo_id: null,
      category: 'sport',
      brand: 'Nike',
      cost_price_tnd: 30000,
      sale_price_tnd: 60000,
      notes: null,
      variants: [
        { color: 'black', size: '40', floor_qty: 5, back_qty: 35 },
        { color: 'yellow', size: '40', floor_qty: 2, back_qty: 8 },
        { color: 'white', size: '23', floor_qty: 0, back_qty: 30 },
      ],
    });
    expect(variants.length).toBe(3);
    // 5 of the 6 floor/back qty cells are non-zero → 5 seed movements.
    expect(movements.length).toBe(5);
    expect(movements.filter((m) => m.location === 'floor').length).toBe(2);
    expect(movements.filter((m) => m.location === 'back').length).toBe(3);
  });

  it('computes search_blob through the canonical pipeline', async () => {
    const { article } = await createArticle(db, baseInput);
    expect(article.search_blob).toContain('white running');
    expect(article.search_blob).toContain('sh-0001');
    expect(article.search_blob).toContain('white');
    expect(article.search_blob).toContain('nike');
    expect(article.search_blob).toContain('sport');
    expect(article.search_blob).toBe(article.search_blob.toLowerCase());
  });

  it('skips the seed movement when initial_qty is 0 but still creates the variant', async () => {
    const { variants, movements } = await createArticle(db, {
      ...baseInput,
      sizes: [
        { size: '40', initial_qty: 0 },
        { size: '41', initial_qty: 3 },
      ],
    });
    expect(variants.length).toBe(2);
    expect(movements.length).toBe(1);
    expect(movements[0].delta).toBe(3);
  });

  it('rejects negative or non-integer initial_qty', async () => {
    await expect(
      createArticle(db, { ...baseInput, sizes: [{ size: '40', initial_qty: -1 }] }),
    ).rejects.toThrow(/non-negative integer/);
    await expect(
      createArticle(db, { ...baseInput, sizes: [{ size: '40', initial_qty: 1.5 }] }),
    ).rejects.toThrow(/non-negative integer/);
  });

  it('allocates monotonically increasing internal codes across creates', async () => {
    const a = await createArticle(db, { ...baseInput, sizes: [{ size: '40', initial_qty: 1 }] });
    const b = await createArticle(db, { ...baseInput, sizes: [{ size: '40', initial_qty: 1 }] });
    const c = await createArticle(db, { ...baseInput, sizes: [{ size: '40', initial_qty: 1 }] });
    expect([a.article.internal_code, b.article.internal_code, c.article.internal_code]).toEqual([
      'SH-0001',
      'SH-0002',
      'SH-0003',
    ]);
  });
});

describe('articles repo — read / update / archive', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('getArticle hides soft-deleted rows but exposes archived ones', async () => {
    const { article } = await createArticle(db, baseInput);
    await archiveArticle(db, article.id);
    expect((await getArticle(db, article.id))?.archived_at).not.toBeNull();

    await db.articles.update(article.id, { deleted_at: NOW });
    expect(await getArticle(db, article.id)).toBeUndefined();
  });

  it('updateArticle recomputes search_blob and bumps updated_at', async () => {
    const { article } = await createArticle(db, baseInput);
    vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
    const after = await updateArticle(db, article.id, {
      name: 'Black running shoe',
    });
    expect(after.name).toBe('Black running shoe');
    // Colours are derived from variants in v0.3 — the legacy `colors`
    // cache reflects whatever variants exist, not anything passed to
    // updateArticle. The seed input has white + gray.
    expect(after.colors.sort()).toEqual(['gray', 'white']);
    expect(after.search_blob).toContain('black running');
    expect(after.search_blob).not.toContain('white running');
    expect(after.updated_at).toBe('2026-05-08T00:00:00.000Z');
  });

  it('updateArticle rejects edits to deleted rows', async () => {
    const { article } = await createArticle(db, baseInput);
    await db.articles.update(article.id, { deleted_at: NOW });
    await expect(updateArticle(db, article.id, { name: 'X' })).rejects.toThrow(/deleted/);
  });

  it('archive / unarchive flip archived_at', async () => {
    const { article } = await createArticle(db, baseInput);
    await archiveArticle(db, article.id);
    expect((await db.articles.get(article.id))?.archived_at).not.toBeNull();
    await unarchiveArticle(db, article.id);
    expect((await db.articles.get(article.id))?.archived_at).toBeNull();
  });

  it('archive throws on unknown id', async () => {
    await expect(archiveArticle(db, 'nope')).rejects.toThrow(/no article/i);
  });
});

describe('articles repo — hardDeleteArticle (cascade)', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('removes the article, its variants, its movements, and its photo', async () => {
    const photo = await storePhoto(db, {
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      width: 1,
      height: 1,
      mime: 'image/jpeg',
    });
    const { article, variants, movements } = await createArticle(db, {
      ...baseInput,
      photo_id: photo.id,
    });

    await hardDeleteArticle(db, article.id);

    expect(await db.articles.get(article.id)).toBeUndefined();
    for (const v of variants) {
      expect(await db.variants.get(v.id)).toBeUndefined();
    }
    for (const m of movements) {
      expect(await db.movements.get(m.id)).toBeUndefined();
    }
    expect(await db.photos.get(photo.id)).toBeUndefined();
  });

  it('does not touch other articles', async () => {
    const a = await createArticle(db, baseInput);
    const b = await createArticle(db, { ...baseInput, sizes: [{ size: '42', initial_qty: 1 }] });

    await hardDeleteArticle(db, a.article.id);

    expect(await db.articles.get(b.article.id)).toBeDefined();
    expect(await db.variants.where('article_id').equals(b.article.id).count()).toBe(1);
  });

  it('throws on unknown id', async () => {
    await expect(hardDeleteArticle(db, 'nope')).rejects.toThrow(/no article/i);
  });
});

describe('articles repo — listArticles', () => {
  let db: InventarDB;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    db = new InventarDB();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await indexedDB.deleteDatabase(DB_NAME);
    vi.useRealTimers();
  });

  it('default sort is recent (updated_at desc), excludes archived and deleted', async () => {
    const a = await createArticle(db, { ...baseInput, name: 'A' });
    vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
    const b = await createArticle(db, { ...baseInput, name: 'B' });
    vi.setSystemTime(new Date('2026-05-03T00:00:00.000Z'));
    const c = await createArticle(db, { ...baseInput, name: 'C' });

    await archiveArticle(db, b.article.id);
    await db.articles.update(c.article.id, { deleted_at: '2026-05-03T00:00:00.000Z' });

    const out = await listArticles(db);
    expect(out.map((x) => x.name)).toEqual(['A']);
    void a;
  });

  it('includeArchived: true shows archived rows but never deleted ones', async () => {
    const a = await createArticle(db, { ...baseInput, name: 'A' });
    vi.setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
    const b = await createArticle(db, { ...baseInput, name: 'B' });
    await archiveArticle(db, b.article.id);
    await db.articles.update(a.article.id, { deleted_at: '2026-05-02T00:00:00.000Z' });

    const out = await listArticles(db, { includeArchived: true });
    expect(out.map((x) => x.name)).toEqual(['B']);
  });

  it('filters by category', async () => {
    await createArticle(db, { ...baseInput, name: 'Sport', category: 'sport' });
    await createArticle(db, { ...baseInput, name: 'Dress', category: 'dress' });
    const out = await listArticles(db, { category: 'dress' });
    expect(out.map((x) => x.name)).toEqual(['Dress']);
  });

  it('sort=name returns A→Z', async () => {
    await createArticle(db, { ...baseInput, name: 'Charlie' });
    await createArticle(db, { ...baseInput, name: 'alpha' });
    await createArticle(db, { ...baseInput, name: 'Bravo' });
    const out = await listArticles(db, { sort: 'name' });
    expect(out.map((x) => x.name)).toEqual(['alpha', 'Bravo', 'Charlie']);
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      vi.setSystemTime(new Date(`2026-05-0${i + 1}T00:00:00.000Z`));
      await createArticle(db, { ...baseInput, name: `A${i}` });
    }
    expect((await listArticles(db, { limit: 2 })).length).toBe(2);
  });
});
