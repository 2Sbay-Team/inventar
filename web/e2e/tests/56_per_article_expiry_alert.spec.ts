import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-023 — per-article expiry-alert override. The Article
// Detail editor exposes Article.expiry_alert_days; setting it overrides
// the global ShopProfile.expiry_warning_days for THIS article. Editor
// is shop-only (fashion has no expiry tracking).

test.describe('Article Detail — per-article expiry_alert_days', () => {
  test('shop article: editor visible; persists override; clearing reverts to global', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Mini Mart',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    // Seed an article so we have a detail page to land on.
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: 'a-test',
          internal_code: 'SP-0001',
          name: 'Yogurt 4-pack',
          photo_id: null,
          category: 'dairy',
          colors: [],
          brand: null,
          cost_price_tnd: 2000,
          sale_price_tnd: 3000,
          notes: null,
          barcode_ean: null,
          min_stock_threshold: null,
          expiry_alert_days: null,
          search_blob: 'yogurt 4-pack',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'v-test',
          article_id: 'a-test',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        });
      });
      idb.close();
    });

    await page.goto('/article/a-test');
    await expect(page.getByTestId('expiry-alert-editor')).toBeVisible();
    // Empty (null = use global default).
    await expect(page.getByTestId('detail-expiry-alert')).toHaveValue('');

    // Set override to 3 days.
    await page.getByTestId('detail-expiry-alert').fill('3');
    await page.getByTestId('detail-expiry-alert').blur();

    // Wait for the persist round-trip + verify storage.
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const dbReq = indexedDB.open('inventar');
          await new Promise<void>((resolve) => {
            dbReq.onsuccess = () => resolve();
          });
          const idb = dbReq.result;
          const a = await new Promise<{ expiry_alert_days: number | null } | undefined>(
            (resolve) => {
              const tx = idb.transaction('articles', 'readonly');
              const r = tx.objectStore('articles').get('a-test');
              r.onsuccess = () =>
                resolve(r.result as { expiry_alert_days: number | null } | undefined);
            },
          );
          idb.close();
          return a?.expiry_alert_days ?? -1;
        }),
      )
      .toBe(3);

    // Clear → null again.
    await page.getByTestId('detail-expiry-alert').fill('');
    await page.getByTestId('detail-expiry-alert').blur();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const dbReq = indexedDB.open('inventar');
          await new Promise<void>((resolve) => {
            dbReq.onsuccess = () => resolve();
          });
          const idb = dbReq.result;
          const a = await new Promise<{ expiry_alert_days: number | null } | undefined>(
            (resolve) => {
              const tx = idb.transaction('articles', 'readonly');
              const r = tx.objectStore('articles').get('a-test');
              r.onsuccess = () =>
                resolve(r.result as { expiry_alert_days: number | null } | undefined);
            },
          );
          idb.close();
          return a?.expiry_alert_days;
        }),
      )
      .toBeNull();
  });

  test('fashion article: expiry-alert editor is HIDDEN (no expiry tracking)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique',
      storeType: 'fashion',
    });
    await page.reload();

    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: 'fa-test',
          internal_code: 'FN-0001',
          name: 'Cotton Tee',
          photo_id: null,
          category: 'shirts',
          colors: [],
          brand: null,
          cost_price_tnd: 10000,
          sale_price_tnd: 25000,
          notes: null,
          barcode_ean: null,
          min_stock_threshold: null,
          expiry_alert_days: null,
          search_blob: 'cotton tee',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'vfa',
          article_id: 'fa-test',
          color: 'white',
          size: 'M',
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        });
      });
      idb.close();
    });

    await page.goto('/article/fa-test');
    await expect(page.getByTestId('detail-sku')).toBeVisible();
    await expect(page.getByTestId('expiry-alert-editor')).toHaveCount(0);
  });
});
