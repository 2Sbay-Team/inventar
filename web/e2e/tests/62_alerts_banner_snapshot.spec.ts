import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-018 — alerts banner snapshot reappearance. The banner
// counts low-stock + expiring lots; "Hide for 7 days" stamps both
// hidden_until AND alerts_banner_hidden_count_snapshot. Banner re-
// shows when current count exceeds the snapshot, even if hidden_until
// is still in the future — handles the case where new alerts arrive
// during the suppression window.

async function seedShopArticle(
  page: Page,
  args: { id: string; code: string; threshold: number; stock: number },
): Promise<void> {
  await page.evaluate(async (a) => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve) => {
      dbReq.onsuccess = () => resolve();
    });
    const idb = dbReq.result;
    const now = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore('articles').add({
        id: a.id,
        internal_code: a.code,
        name: `Article ${a.code}`,
        photo_id: null,
        category: 'drinks',
        colors: [],
        brand: null,
        cost_price_tnd: 1000,
        sale_price_tnd: 2000,
        notes: null,
        barcode_ean: null,
        min_stock_threshold: a.threshold,
        expiry_alert_days: null,
        search_blob: a.code.toLowerCase(),
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: `v-${a.id}`,
        article_id: a.id,
        color: null,
        size: null,
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      if (a.stock > 0) {
        tx.objectStore('movements').add({
          id: `m-${a.id}`,
          variant_id: `v-${a.id}`,
          delta: a.stock,
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
    idb.close();
  }, args);
}

test.describe('AlertsBanner — snapshot reappearance', () => {
  test('shows when low-stock count > 0; tap → /alerts; hide → suppressed', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Banner Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedShopArticle(page, { id: 'a1', code: 'SP-0001', threshold: 10, stock: 3 });
    await page.reload();

    // Banner shows with count 1.
    await expect(page.getByTestId('alerts-banner')).toBeVisible();
    await expect(page.getByTestId('alerts-banner')).toContainText('1');

    // Tap → /alerts (low tab default).
    await page.getByTestId('alerts-banner-tap').click();
    await expect(page).toHaveURL(/\/alerts/);

    // Back to home + hide.
    await page.goto('/');
    await page.getByTestId('alerts-banner-hide').click();
    // Banner gone (count = snapshot, hidden_until > now).
    await expect(page.getByTestId('alerts-banner')).toHaveCount(0);
    // Reload — still hidden.
    await page.reload();
    await expect(page.getByTestId('alerts-banner')).toHaveCount(0);
  });

  test('reappears when count grows past the snapshot (new alert arrives mid-suppression)', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Snapshot Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedShopArticle(page, { id: 'a1', code: 'SP-0001', threshold: 10, stock: 3 });
    await page.reload();

    await expect(page.getByTestId('alerts-banner')).toBeVisible();
    await page.getByTestId('alerts-banner-hide').click();
    await expect(page.getByTestId('alerts-banner')).toHaveCount(0);

    // Add a SECOND low-stock article. Count jumps from 1 → 2 (the
    // snapshot taken at hide-time was 1).
    await seedShopArticle(page, { id: 'a2', code: 'SP-0002', threshold: 10, stock: 2 });
    await page.reload();

    // Banner re-appears even though hidden_until is still in the
    // future, because count (2) > snapshot (1).
    await expect(page.getByTestId('alerts-banner')).toBeVisible();
    await expect(page.getByTestId('alerts-banner')).toContainText('2');
  });
});
