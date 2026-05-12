import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-018: dashboard renders three shop-only widgets — Today's
// close, Items running low, Expiring soon. Mounted as a unit behind
// the profile.store_type === 'shop' guard. Non-shop verticals never
// render the widgets, even with the same underlying data.

test('dashboard: shop merchant sees the three widgets with correct counts', async ({ page }) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Widget Shop',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  // Seed: one article above the low-stock threshold (so the
  // items-low count stays clean), one article below threshold,
  // one article with an expiring lot, plus a sale today.
  const expiresIso = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  await page.evaluate(
    async ({ exp }) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((r, j) => {
        dbReq.onsuccess = () => r();
        dbReq.onerror = () => j(dbReq.error);
      });
      const idb = dbReq.result;
      const ts = new Date().toISOString();
      const txnId = 'today-txn-1';
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements', 'lots'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);

        // Article A — low stock (threshold 5, current 2). Three units
        // received historically; one sale today brings it to 2.
        tx.objectStore('articles').add({
          id: 'low-art',
          internal_code: 'GR-0001',
          name: 'Low Stock Item',
          photo_id: null,
          category: 'beverages',
          colors: [],
          brand: null,
          cost_price_tnd: 1000,
          sale_price_tnd: 1500,
          notes: null,
          barcode_ean: '1111111111116',
          min_stock_threshold: 5,
          search_blob: 'low stock item beverages gr-0001',
          updated_at: ts,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'low-var',
          article_id: 'low-art',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: ts,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'low-purchase',
          variant_id: 'low-var',
          delta: 3,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: null,
          lot_id: null,
          created_at: ts,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'low-sale-today',
          variant_id: 'low-var',
          delta: -1,
          type: 'sale',
          note: null,
          unit_price_tnd: null,
          location: 'floor',
          transfer_from: null,
          transfer_to: null,
          transaction_id: txnId,
          expires_at: null,
          lot_id: null,
          created_at: ts,
          deleted_at: null,
        });

        // Article B — expiring soon (lot in 5 days), no low-stock
        // threshold set. 6 units stocked.
        tx.objectStore('articles').add({
          id: 'exp-art',
          internal_code: 'GR-0002',
          name: 'Expiring Item',
          photo_id: null,
          category: 'dairy',
          colors: [],
          brand: null,
          cost_price_tnd: 800,
          sale_price_tnd: 1200,
          notes: null,
          barcode_ean: '2222222222226',
          min_stock_threshold: null,
          search_blob: 'expiring item dairy gr-0002',
          updated_at: ts,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'exp-var',
          article_id: 'exp-art',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: ts,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'exp-purchase',
          variant_id: 'exp-var',
          delta: 6,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: exp,
          lot_id: null,
          created_at: ts,
          deleted_at: null,
        });
        tx.objectStore('lots').add({
          id: 'exp-lot',
          variant_id: 'exp-var',
          expires_at: exp,
          received_at: ts,
          original_quantity: 6,
          source_movement_id: 'exp-purchase',
          deleted_at: null,
        });

        // Article C — well-stocked, no expiry. Establishes a baseline
        // so widget counts reflect the right thing (Items low = 1,
        // Expiring soon = 1).
        tx.objectStore('articles').add({
          id: 'ok-art',
          internal_code: 'GR-0003',
          name: 'Stable Stock Item',
          photo_id: null,
          category: 'snacks',
          colors: [],
          brand: null,
          cost_price_tnd: 500,
          sale_price_tnd: 800,
          notes: null,
          barcode_ean: '3333333333336',
          min_stock_threshold: 3,
          search_blob: 'stable stock item snacks gr-0003',
          updated_at: ts,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'ok-var',
          article_id: 'ok-art',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: ts,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'ok-purchase',
          variant_id: 'ok-var',
          delta: 50,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: null,
          lot_id: null,
          created_at: ts,
          deleted_at: null,
        });
      });
      idb.close();
    },
    { exp: expiresIso },
  );
  await page.reload();

  // Open Dashboard via nav (shop nav has /dashboard slot).
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible();

  const widgets = page.getByTestId('shop-widgets');
  await expect(widgets).toBeVisible();
  await expect(page.getByTestId('widget-today-close')).toBeVisible();
  await expect(page.getByTestId('widget-items-low')).toBeVisible();
  await expect(page.getByTestId('widget-expiring-soon')).toBeVisible();

  // Today's close — one sale today at 1.500 TND, top seller "Low Stock
  // Item" with qty 1.
  await expect(page.getByTestId('widget-today-close-revenue')).toContainText('1');
  await expect(page.getByTestId('widget-today-close-summary')).toContainText('Low Stock Item');

  // Items low — only Article A (current 2 < threshold 5). Article C
  // is at 50 (well above 3); Article B has no threshold set.
  await expect(page.getByTestId('widget-items-low-count')).toHaveText('1');

  // Expiring soon — only Article B's lot.
  await expect(page.getByTestId('widget-expiring-soon-count')).toHaveText('1');
});

test('dashboard: shoes merchant does not see the shop widgets', async ({ page }) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Shoes Test',
    // storeType omitted → default shoes.
  });
  await page.reload();
  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  await expect(page.getByTestId('shop-widgets')).toHaveCount(0);
  await expect(page.getByTestId('widget-today-close')).toHaveCount(0);
  await expect(page.getByTestId('widget-items-low')).toHaveCount(0);
  await expect(page.getByTestId('widget-expiring-soon')).toHaveCount(0);
});
