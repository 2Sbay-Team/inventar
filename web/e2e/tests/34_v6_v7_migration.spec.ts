import { expect, test } from '@playwright/test';

// v0.5 ADR-017 — exercise the v6 → v7 Dexie upgrade path inside a real
// browser. The unit test in src/db/migrate-v6-to-v7.test.ts proves the
// kernel; this proves the wiring through Dexie's upgrade pipeline does
// the right thing on a database that already contains v6 rows.
//
// Approach: open a fresh raw IndexedDB at version 6, create the seven
// stores by name (Dexie will add v7's indexes on next open), populate
// the brief's required fixture (kiosk + grocery + shoes), then close
// and trigger the v7 upgrade by reloading the app shell. Dexie sees
// `database.version === 6` on the existing database and runs versions
// 7's upgrade callback, which dispatches to the kernel.

test.describe('v6 → v7 migration smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__inventarSeed));
    await page.evaluate(async () => {
      await window.__inventarSeed!.deleteDb();
    });
  });

  test('kiosk profile + 5-article fixture rolls forward correctly', async ({ page }) => {
    const NOW = '2026-05-09T12:00:00.000Z';

    // Step 1: build a v6 database via raw IndexedDB. We create the seven
    // stores with primaryKey only — v7's upgrade will add the new lots
    // table and any new indexes; existing indexes get rebuilt automatically.
    await page.evaluate(
      async ({ now }) => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('inventar', 6);
          req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore('profile', { keyPath: 'id' });
            db.createObjectStore('articles', { keyPath: 'id' });
            db.createObjectStore('variants', { keyPath: 'id' });
            db.createObjectStore('movements', { keyPath: 'id' });
            db.createObjectStore('expenses', { keyPath: 'id' });
            db.createObjectStore('photos', { keyPath: 'id' });
            db.createObjectStore('meta', { keyPath: 'key' });
          };
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(
              ['profile', 'articles', 'variants', 'movements'],
              'readwrite',
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);

            tx.objectStore('profile').add({
              id: 'singleton',
              name: 'Kiosk Joe',
              locale: 'fr',
              logo_photo_id: null,
              currency: 'TND',
              store_type: 'kiosk',
              created_at: now,
              updated_at: now,
              last_backup_at: null,
            });

            const articles = [
              {
                id: 'k1',
                internal_code: 'KI-0001',
                name: 'Cigarettes',
                photo_id: null,
                category: 'tobacco',
                colors: [],
                brand: null,
                cost_price_tnd: 5000,
                sale_price_tnd: 7000,
                notes: null,
                search_blob: 'cigarettes ki-0001',
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              },
              {
                id: 'k2',
                internal_code: 'KI-0002',
                name: 'Chocolate Bar',
                photo_id: null,
                category: 'snacks',
                colors: [],
                brand: null,
                cost_price_tnd: 1000,
                sale_price_tnd: 2000,
                notes: null,
                search_blob: 'chocolate bar ki-0002',
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              },
              {
                id: 'g1',
                internal_code: 'GR-0001',
                name: 'Spaghetti',
                photo_id: null,
                category: 'dry_goods',
                colors: [],
                brand: 'Barilla',
                cost_price_tnd: 5000,
                sale_price_tnd: 7000,
                notes: null,
                search_blob: 'spaghetti barilla gr-0001',
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              },
              {
                id: 'g2',
                internal_code: 'GR-0002',
                name: 'Milk',
                photo_id: null,
                category: 'dairy',
                colors: [],
                brand: null,
                cost_price_tnd: 1500,
                sale_price_tnd: 2500,
                notes: null,
                search_blob: 'milk gr-0002',
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              },
              {
                id: 's1',
                internal_code: 'SH-0001',
                name: 'Sneaker',
                photo_id: null,
                category: 'sport',
                colors: ['white'],
                brand: null,
                cost_price_tnd: 50000,
                sale_price_tnd: 90000,
                notes: null,
                search_blob: 'sneaker sh-0001 white sport',
                updated_at: now,
                archived_at: null,
                deleted_at: null,
              },
            ];
            for (const a of articles) tx.objectStore('articles').add(a);

            const variants = [
              {
                id: 'k1-v',
                article_id: 'k1',
                color: null,
                size: null,
                photo_id: null,
                hidden: false,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 'k2-v',
                article_id: 'k2',
                color: null,
                size: null,
                photo_id: null,
                hidden: false,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 'g1-v',
                article_id: 'g1',
                color: null,
                size: null,
                photo_id: null,
                hidden: false,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 'g2-v',
                article_id: 'g2',
                color: null,
                size: null,
                photo_id: null,
                hidden: false,
                updated_at: now,
                deleted_at: null,
              },
              {
                id: 's1-v',
                article_id: 's1',
                color: 'white',
                size: '42',
                photo_id: null,
                hidden: false,
                updated_at: now,
                deleted_at: null,
              },
            ];
            for (const v of variants) tx.objectStore('variants').add(v);

            const movements = [
              {
                id: 'm-k1-buy',
                variant_id: 'k1-v',
                delta: 100,
                type: 'purchase',
                note: null,
                unit_price_tnd: null,
                location: 'back',
                transfer_from: null,
                transfer_to: null,
                created_at: now,
                deleted_at: null,
              },
              {
                id: 'm-k1-sell',
                variant_id: 'k1-v',
                delta: -3,
                type: 'sale',
                note: null,
                unit_price_tnd: null,
                location: 'floor',
                transfer_from: null,
                transfer_to: null,
                created_at: now,
                deleted_at: null,
              },
              {
                id: 'm-g1-buy',
                variant_id: 'g1-v',
                delta: 50,
                type: 'purchase',
                note: null,
                unit_price_tnd: null,
                location: 'back',
                transfer_from: null,
                transfer_to: null,
                created_at: now,
                deleted_at: null,
              },
              {
                id: 'm-s1-buy',
                variant_id: 's1-v',
                delta: 10,
                type: 'purchase',
                note: null,
                unit_price_tnd: null,
                location: 'back',
                transfer_from: null,
                transfer_to: null,
                created_at: now,
                deleted_at: null,
              },
            ];
            for (const m of movements) tx.objectStore('movements').add(m);
          };
          req.onerror = () => reject(req.error);
        });
      },
      { now: NOW },
    );

    // Step 2: trigger the v7 upgrade by reloading the app.
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__inventarSeed));

    // Step 3: assert the upgraded rows.
    const profileType = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ store_type: string; shop_subtypes: string[] }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db.transaction('profile', 'readonly').objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const r = req.result as { store_type: string; shop_subtypes: string[] } | undefined;
            resolve({ store_type: r?.store_type ?? '', shop_subtypes: r?.shop_subtypes ?? [] });
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(profileType.store_type).toBe('shop');
    expect(profileType.shop_subtypes).toEqual(['tobacco_lottery', 'snacks_confectionery']);

    const articleSummary = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<
        Array<{
          id: string;
          internal_code: string;
          barcode_ean: unknown;
          min_stock_threshold: unknown;
        }>
      >((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db.transaction('articles', 'readonly').objectStore('articles').getAll();
          req.onsuccess = () =>
            resolve(
              (
                req.result as Array<{
                  id: string;
                  internal_code: string;
                  barcode_ean: unknown;
                  min_stock_threshold: unknown;
                }>
              ).map((a) => ({
                id: a.id,
                internal_code: a.internal_code,
                barcode_ean: a.barcode_ean,
                min_stock_threshold: a.min_stock_threshold,
              })),
            );
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(articleSummary).toHaveLength(5);
    for (const a of articleSummary) {
      expect(a.barcode_ean).toBeNull();
      expect(a.min_stock_threshold).toBeNull();
    }
    // Internal codes preserved verbatim — KI-0001 stays KI-0001.
    expect(articleSummary.map((a) => a.internal_code).sort()).toEqual([
      'GR-0001',
      'GR-0002',
      'KI-0001',
      'KI-0002',
      'SH-0001',
    ]);

    const movementSummary = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<
        Array<{ id: string; transaction_id: unknown; expires_at: unknown; lot_id: unknown }>
      >((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db.transaction('movements', 'readonly').objectStore('movements').getAll();
          req.onsuccess = () =>
            resolve(
              (
                req.result as Array<{
                  id: string;
                  transaction_id: unknown;
                  expires_at: unknown;
                  lot_id: unknown;
                }>
              ).map((m) => ({
                id: m.id,
                transaction_id: m.transaction_id,
                expires_at: m.expires_at,
                lot_id: m.lot_id,
              })),
            );
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(movementSummary).toHaveLength(4);
    for (const m of movementSummary) {
      expect(m.transaction_id).toBeNull();
      expect(m.expires_at).toBeNull();
      expect(m.lot_id).toBeNull();
    }

    const lotCount = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<number>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db.transaction('lots', 'readonly').objectStore('lots').count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(lotCount).toBe(0);

    const migrationStamp = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<unknown>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db
            .transaction('meta', 'readonly')
            .objectStore('meta')
            .get('migration_v7_completed_at');
          req.onsuccess = () => resolve((req.result as { value?: unknown } | undefined)?.value);
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(typeof migrationStamp).toBe('string');
    expect(String(migrationStamp).length).toBeGreaterThan(10);
  });
});
