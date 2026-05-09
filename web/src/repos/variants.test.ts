import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, InventarDB } from '../db/db';
import {
  addVariants,
  getVariantsForArticle,
  setVariantHidden,
  setVariantPhoto,
  softDeleteVariant,
} from './variants';

const NOW = '2026-05-07T00:00:00.000Z';

describe('variants repo', () => {
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

  describe('addVariants', () => {
    it('creates one variant per (color, size) cell', async () => {
      const out = await addVariants(db, 'a-1', [
        { color: 'black', size: '40' },
        { color: 'black', size: '41' },
        { color: 'white', size: '40' },
      ]);
      expect(out.length).toBe(3);
      out.forEach((v) => {
        expect(v.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(v.article_id).toBe('a-1');
        expect(v.hidden).toBe(false);
        expect(v.deleted_at).toBeNull();
      });
    });

    it('trims whitespace and dedupes by (color, size)', async () => {
      const out = await addVariants(db, 'a-1', [
        { color: 'black', size: '40' },
        { color: 'BLACK', size: ' 40' },
        { color: 'black', size: '40 ' },
      ]);
      expect(out.length).toBe(1);
      expect(out[0]?.size).toBe('40');
      expect(out[0]?.color).toBe('black');
    });

    it('treats different colours as distinct even at the same size', async () => {
      const out = await addVariants(db, 'a-1', [
        { color: 'black', size: '40' },
        { color: 'white', size: '40' },
      ]);
      expect(out.length).toBe(2);
      expect(new Set(out.map((v) => v.color))).toEqual(new Set(['black', 'white']));
    });

    it('reuses an existing live variant rather than creating a duplicate', async () => {
      const [first] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      const [second] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      expect(second?.id).toBe(first?.id);
      expect(await db.variants.count()).toBe(1);
    });

    it('revives a tombstoned variant for the same [article_id+color+size]', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      await softDeleteVariant(db, v!.id);
      vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
      const [revived] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      expect(revived?.id).toBe(v?.id);
      expect(revived?.deleted_at).toBeNull();
      expect(revived?.updated_at).toBe('2026-05-08T00:00:00.000Z');
    });

    it('accepts a colourless spec for sizeless verticals', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: null, size: null }]);
      expect(v?.color).toBeNull();
      expect(v?.size).toBeNull();
    });

    it('rejects empty / whitespace-only sizes when not null', async () => {
      await expect(addVariants(db, 'a-1', [{ color: 'black', size: '' }])).rejects.toThrow(/empty/);
      await expect(addVariants(db, 'a-1', [{ color: 'black', size: '   ' }])).rejects.toThrow(
        /empty/,
      );
    });

    it('rejects sizes longer than 8 chars (SPEC §6)', async () => {
      await expect(addVariants(db, 'a-1', [{ color: 'black', size: '123456789' }])).rejects.toThrow(
        /8 chars/,
      );
    });

    it('rejects sizes with disallowed characters', async () => {
      await expect(addVariants(db, 'a-1', [{ color: 'black', size: '42!' }])).rejects.toThrow(
        /invalid/,
      );
    });

    it('accepts compound numeric sizes like 32x34', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '32x34' }]);
      expect(v?.size).toBe('32x34');
    });

    it('lowercases colours so search index stays consistent', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'BLACK', size: '40' }]);
      expect(v?.color).toBe('black');
    });
  });

  describe('getVariantsForArticle', () => {
    it('returns alive variants scoped to the article', async () => {
      await addVariants(db, 'a-1', [
        { color: 'black', size: '40' },
        { color: 'black', size: '41' },
      ]);
      await addVariants(db, 'a-2', [{ color: 'black', size: '40' }]);
      const list = await getVariantsForArticle(db, 'a-1');
      expect(list.map((v) => v.size).sort()).toEqual(['40', '41']);
    });

    it('hides soft-deleted variants', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      await softDeleteVariant(db, v!.id);
      expect(await getVariantsForArticle(db, 'a-1')).toEqual([]);
    });
  });

  describe('setVariantHidden', () => {
    it('toggles the cosmetic hidden flag and bumps updated_at', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
      await setVariantHidden(db, v!.id, true);
      const after = await db.variants.get(v!.id);
      expect(after?.hidden).toBe(true);
      expect(after?.updated_at).toBe('2026-05-08T00:00:00.000Z');
    });

    it('throws on unknown id', async () => {
      await expect(setVariantHidden(db, 'nope', true)).rejects.toThrow(/no variant/i);
    });
  });

  describe('setVariantPhoto', () => {
    it('updates photo_id and bumps updated_at', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      vi.setSystemTime(new Date('2026-05-08T00:00:00.000Z'));
      const after = await setVariantPhoto(db, v!.id, 'p-1');
      expect(after.photo_id).toBe('p-1');
      expect(after.updated_at).toBe('2026-05-08T00:00:00.000Z');
    });

    it('clearing accepts null', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40', photo_id: 'p-1' }]);
      const after = await setVariantPhoto(db, v!.id, null);
      expect(after.photo_id).toBeNull();
    });

    it('throws on deleted variant', async () => {
      const [v] = await addVariants(db, 'a-1', [{ color: 'black', size: '40' }]);
      await softDeleteVariant(db, v!.id);
      await expect(setVariantPhoto(db, v!.id, 'p-1')).rejects.toThrow(/deleted/);
    });
  });
});
