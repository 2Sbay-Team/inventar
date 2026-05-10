import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-017 — data-path proof for the new shop-vertical fields
// (barcode_ean + min_stock_threshold) added to Article in commit 1.
//
// The UI badge for low stock + the receive scan flow that reads
// barcode_ean both land in later commits. This spec proves the storage
// round-trip works end-to-end so the later UI commits can build on top
// without re-validating the data layer.
//
// We exercise the seed surface (window.__inventarSeed) which calls the
// same createArticle repo path the live UI does, then read raw
// IndexedDB to confirm the values landed on the row.

test.describe('v0.5 shop fields data path', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Threshold Shop' });
    await page.reload();
  });

  test('createArticle persists min_stock_threshold and barcode_ean; null for legacy seeds', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Threshold Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Threshold Spaghetti',
            sizes: [{ size: '', qty: 10 }],
            barcode_ean: '8076809529433',
            min_stock_threshold: 5,
          },
          {
            name: 'No Threshold Milk',
            sizes: [{ size: '', qty: 8 }],
            // both fields omitted — repo defaults to null.
          },
        ],
      });
    });

    const rows = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<
        Array<{ name: string; barcode_ean: unknown; min_stock_threshold: unknown }>
      >((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db.transaction('articles', 'readonly').objectStore('articles').getAll();
          req.onsuccess = () =>
            resolve(
              (
                req.result as Array<{
                  name: string;
                  barcode_ean: unknown;
                  min_stock_threshold: unknown;
                }>
              ).map((a) => ({
                name: a.name,
                barcode_ean: a.barcode_ean,
                min_stock_threshold: a.min_stock_threshold,
              })),
            );
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });

    const spaghetti = rows.find((r) => r.name === 'Threshold Spaghetti');
    const milk = rows.find((r) => r.name === 'No Threshold Milk');
    expect(spaghetti?.min_stock_threshold).toBe(5);
    expect(spaghetti?.barcode_ean).toBe('8076809529433');
    expect(milk?.min_stock_threshold).toBeNull();
    expect(milk?.barcode_ean).toBeNull();
  });

  test('barcode_ean index supports lookup by EAN (used by /receive in commit 3)', async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'EAN Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Barcoded Coke',
            sizes: [{ size: '', qty: 24 }],
            barcode_ean: '5449000000996',
          },
        ],
      });
    });

    const found = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ name: string; barcode_ean: string } | null>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const req = db
            .transaction('articles', 'readonly')
            .objectStore('articles')
            .index('barcode_ean')
            .get('5449000000996');
          req.onsuccess = () => {
            const r = req.result as { name: string; barcode_ean: string } | undefined;
            resolve(r ? { name: r.name, barcode_ean: r.barcode_ean } : null);
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(found?.name).toBe('Barcoded Coke');
    expect(found?.barcode_ean).toBe('5449000000996');
  });
});
