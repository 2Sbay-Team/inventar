import { expect, test } from '@playwright/test';

// Verifies the v5 → v6 Dexie upgrade callback wires correctly to the
// migrate-v5-to-v6 kernel in a real browser context.
//
// Strategy: navigate once so the page is alive, then via page.evaluate
//   1) close any in-flight Dexie connection,
//   2) wipe the IDB,
//   3) re-open it at version 5 with the legacy schema,
//   4) populate v5-shape fixture rows,
//   5) close.
// Then reload the page — the app boots, opens Dexie at version 6, the
// upgrade callback runs migrate-v5-to-v6 against the fixture, and we
// assert the post-state via the seed surface and direct IDB reads.
//
// The kernel itself is exhaustively unit-tested in
// src/db/migrate-v5-to-v6 + src/backup/round-trip; this test covers the
// integration surface the unit tests can't reach: the Dexie upgrade
// callback's wiring, the meta-key writes, and that the resulting rows
// survive a reload in a real browser.

test.describe('v5 → v6 migration', () => {
  test('fans variants out per (colour × old variant) and remaps movements', async ({ page }) => {
    // First paint — onboarding gate is fine, we don't actually need to
    // complete it. We just need a page on the origin so page.evaluate
    // can talk to the same-origin IDB.
    await page.goto('/');

    // ---- Step 1–5: install a v5 fixture in IndexedDB ----
    await page.evaluate(async () => {
      // Close anything Dexie may have opened. We can't import Dexie
      // here — but the seed surface is mounted in dev/e2e builds and
      // exposes a delete-DB helper that closes Dexie cleanly first.
      if (window.__inventarSeed?.deleteDb) {
        await window.__inventarSeed.deleteDb();
      } else {
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase('inventar');
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
          r.onblocked = () => resolve();
        });
      }

      // Open the legacy v5 schema explicitly so the DB exists at v5
      // before the app boots Dexie at v6.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar', 5);
        req.onupgradeneeded = () => {
          const d = req.result;
          const profile = d.createObjectStore('profile', { keyPath: 'id' });
          void profile;
          const articles = d.createObjectStore('articles', { keyPath: 'id' });
          articles.createIndex('internal_code', 'internal_code');
          articles.createIndex('colors', 'colors', { multiEntry: true });
          articles.createIndex('category', 'category');
          articles.createIndex('archived_at', 'archived_at');
          articles.createIndex('deleted_at', 'deleted_at');
          articles.createIndex('updated_at', 'updated_at');
          articles.createIndex('search_blob', 'search_blob');
          const variants = d.createObjectStore('variants', { keyPath: 'id' });
          variants.createIndex('article_id', 'article_id');
          variants.createIndex('[article_id+size]', ['article_id', 'size']);
          variants.createIndex('deleted_at', 'deleted_at');
          const movements = d.createObjectStore('movements', { keyPath: 'id' });
          movements.createIndex('variant_id', 'variant_id');
          movements.createIndex('type', 'type');
          movements.createIndex('created_at', 'created_at');
          movements.createIndex('[variant_id+created_at]', ['variant_id', 'created_at']);
          movements.createIndex('deleted_at', 'deleted_at');
          const expenses = d.createObjectStore('expenses', { keyPath: 'id' });
          expenses.createIndex('category', 'category');
          expenses.createIndex('at', 'at');
          expenses.createIndex('deleted_at', 'deleted_at');
          const photos = d.createObjectStore('photos', { keyPath: 'id' });
          photos.createIndex('deleted_at', 'deleted_at');
          d.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      const ts = '2026-04-01T00:00:00.000Z';
      const tx = db.transaction(['profile', 'articles', 'variants', 'movements'], 'readwrite');
      tx.objectStore('profile').add({
        id: 'singleton',
        name: 'Migration Shop',
        locale: 'fr',
        logo_photo_id: null,
        currency: 'TND',
        store_type: 'shoes',
        created_at: ts,
        updated_at: ts,
        last_backup_at: null,
      });

      // Article 1: multi-colour (black + yellow) — its movements will be
      // ambiguous and gain the (migrated v5→v6 ...) marker.
      tx.objectStore('articles').add({
        id: 'a-multi',
        internal_code: 'SH-0001',
        name: 'Air Max',
        photo_id: null,
        category: 'sport',
        colors: ['black', 'yellow'],
        brand: 'Nike',
        cost_price_tnd: 40000,
        sale_price_tnd: 75000,
        notes: null,
        search_blob: 'air max sh-0001 nike black yellow sport',
        updated_at: ts,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: 'v-multi-40',
        article_id: 'a-multi',
        size: '40',
        hidden: false,
        updated_at: ts,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'm-multi-1',
        variant_id: 'v-multi-40',
        delta: 5,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        created_at: ts,
        deleted_at: null,
      });

      // Article 2: single colour — unambiguous remap, no marker.
      tx.objectStore('articles').add({
        id: 'a-single',
        internal_code: 'SH-0002',
        name: 'Plain Runner',
        photo_id: null,
        category: 'sport',
        colors: ['white'],
        brand: null,
        cost_price_tnd: 30000,
        sale_price_tnd: 60000,
        notes: null,
        search_blob: 'plain runner sh-0002 white sport',
        updated_at: ts,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: 'v-single-39',
        article_id: 'a-single',
        size: '39',
        hidden: false,
        updated_at: ts,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'm-single-1',
        variant_id: 'v-single-39',
        delta: 3,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        created_at: ts,
        deleted_at: null,
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    // ---- Reload — Dexie boots at v6 and the upgrade callback runs ----
    await page.reload();

    // ---- Inspect the post-migration state ----
    const result = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['variants', 'movements', 'meta'], 'readonly');
      const variants = await new Promise<unknown[]>((resolve, reject) => {
        const r = tx.objectStore('variants').getAll();
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
      const movements = await new Promise<unknown[]>((resolve, reject) => {
        const r = tx.objectStore('movements').getAll();
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
      const migrationCompleted = await new Promise<unknown>((resolve, reject) => {
        const r = tx.objectStore('meta').get('migration_v6_completed_at');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return { variants, movements, migrationCompleted };
    });

    type V = {
      id: string;
      article_id: string;
      color: string | null;
      size: string | null;
      deleted_at: string | null;
    };
    type M = {
      id: string;
      variant_id: string;
      type: string;
      note: string | null;
      location: 'floor' | 'back' | null;
    };
    const variants = result.variants as V[];
    const movements = result.movements as M[];

    // The two legacy variants survived as tombstones (deleted_at != null)
    // alongside the new fan-out variants. Multi-colour article: 1 legacy +
    // 2 new (black/40, yellow/40) = 3 rows. Single-colour article: 1
    // legacy + 1 new (white/39) = 2 rows. Total = 5.
    expect(variants.length).toBe(5);
    const alive = variants.filter((v) => v.deleted_at === null);
    expect(alive.length).toBe(3);
    const multiAlive = alive.filter((v) => v.article_id === 'a-multi');
    expect(multiAlive.length).toBe(2);
    expect(new Set(multiAlive.map((v) => v.color))).toEqual(new Set(['black', 'yellow']));
    expect(multiAlive.every((v) => v.size === '40')).toBe(true);
    const singleAlive = alive.filter((v) => v.article_id === 'a-single');
    expect(singleAlive.length).toBe(1);
    expect(singleAlive[0]?.color).toBe('white');
    expect(singleAlive[0]?.size).toBe('39');

    // Both movements still exist and now resolve to a live variant. The
    // multi-colour movement carries the marker note; the single-colour
    // one does not (unambiguous remap).
    expect(movements.length).toBe(2);
    expect(movements.every((m) => m.location === 'back')).toBe(true);
    const multiMovement = movements.find((m) => m.id === 'm-multi-1')!;
    expect(multiMovement.note).toMatch(/migrated v5→v6/);
    expect(alive.some((v) => v.id === multiMovement.variant_id && v.article_id === 'a-multi')).toBe(
      true,
    );
    const singleMovement = movements.find((m) => m.id === 'm-single-1')!;
    expect(singleMovement.note).toBeNull();
    expect(singleMovement.variant_id).toBe(singleAlive[0]?.id);

    // Migration meta key is set so the banner / review screen can find
    // their work in commit 7.
    expect(typeof result.migrationCompleted).toBe('object');
    expect((result.migrationCompleted as { value: string }).value).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
