import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-018 — consolidated /alerts screen with two tabs. The
// /expiry route is now a permanent redirect to /alerts?tab=expiring.

test.describe('/alerts consolidation', () => {
  test('shop: visits /alerts → both tabs visible, defaults to Stock running low', async ({
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
    await page.goto('/alerts');

    await expect(page.getByTestId('alerts-screen')).toBeVisible();
    await expect(page.getByTestId('alerts-tab-low')).toBeVisible();
    await expect(page.getByTestId('alerts-tab-expiring')).toBeVisible();
    // Defaults to low tab.
    await expect(page.getByTestId('alerts-tab-low')).toHaveAttribute('aria-pressed', 'true');
    // Empty state for low-stock when no articles meet the criteria.
    await expect(page.getByTestId('alerts-low-empty')).toBeVisible();
  });

  test('shop: ?tab=expiring opens directly to the Expiring soon tab', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Mini Mart',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();
    await page.goto('/alerts?tab=expiring');

    await expect(page.getByTestId('alerts-tab-expiring')).toHaveAttribute('aria-pressed', 'true');
    // Tab 2 mounts the embedded ExpiryScreen — its main testid is
    // expiry-screen (the body, not the original page header).
    await expect(page.getByTestId('expiry-screen')).toBeVisible();
  });

  test('legacy /expiry redirects to /alerts?tab=expiring', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Redirect Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();
    await page.goto('/expiry');

    // The redirect lands on /alerts?tab=expiring; the URL reflects that
    // (search params land via the Navigate's `to` string).
    await expect(page).toHaveURL(/\/alerts\?tab=expiring/);
    await expect(page.getByTestId('alerts-tab-expiring')).toHaveAttribute('aria-pressed', 'true');
  });

  test('fashion: expiring tab is HIDDEN (no expiry tracking for fashion)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique',
      storeType: 'fashion',
    });
    await page.reload();
    await page.goto('/alerts');

    await expect(page.getByTestId('alerts-tab-low')).toBeVisible();
    await expect(page.getByTestId('alerts-tab-expiring')).toHaveCount(0);
  });

  test('low-stock list: shows articles below threshold; tap "Open" routes to article', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Low Stock Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    // Seed two articles: one with threshold + low stock; one without
    // threshold (should NOT appear).
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      function add(
        id: string,
        code: string,
        threshold: number | null,
        stock: number,
      ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore('articles').add({
            id,
            internal_code: code,
            name: `Article ${code}`,
            photo_id: null,
            category: 'drinks',
            colors: [],
            brand: null,
            cost_price_tnd: 1000,
            sale_price_tnd: 2000,
            notes: null,
            barcode_ean: null,
            min_stock_threshold: threshold,
            expiry_alert_days: null,
            search_blob: code.toLowerCase(),
            updated_at: now,
            archived_at: null,
            deleted_at: null,
          });
          tx.objectStore('variants').add({
            id: `v-${id}`,
            article_id: id,
            color: null,
            size: null,
            photo_id: null,
            hidden: false,
            updated_at: now,
            deleted_at: null,
          });
          if (stock > 0) {
            tx.objectStore('movements').add({
              id: `m-${id}`,
              variant_id: `v-${id}`,
              delta: stock,
              type: 'purchase',
              note: null,
              unit_price_tnd: null,
              location: 'back',
              transfer_from: null,
              transfer_to: null,
              transaction_id: null,
              expires_at: null,
              lot_id: null,
              refunds_movement_id: null,
              created_at: now,
              deleted_at: null,
            });
          }
        });
      }
      await add('low-1', 'SP-0001', 10, 3); // below threshold → shows
      await add('low-2', 'SP-0002', null, 0); // no threshold → hidden
      await add('low-3', 'SP-0003', 5, 10); // above threshold → hidden
      idb.close();
    });

    await page.goto('/alerts');
    // Only one row.
    await expect(page.getByTestId('alerts-low-row-SP-0001')).toBeVisible();
    await expect(page.getByTestId('alerts-low-row-SP-0002')).toHaveCount(0);
    await expect(page.getByTestId('alerts-low-row-SP-0003')).toHaveCount(0);

    // Open routes to article-detail for that article.
    await page.getByTestId('alerts-low-row-SP-0001-open').click();
    await expect(page).toHaveURL(/\/article\/low-1/);
  });
});
