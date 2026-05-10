import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-019: shop merchants see a yellow expiry banner on the
// Search screen whenever any Lot is within the merchant-configured
// threshold (default 7 days). Tapping the banner opens /expiry, which
// lists the affected variants and offers per-variant actions
// including "Hide for 7 days" (snoozes the variant by writing a meta
// key that the banner predicate honors).

test('expiry banner shows when a lot is within threshold; Hide-7-days snoozes the variant', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Expiry Test',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  // Compute an expiry date 5 days from now (within the default
  // 7-day threshold). Lot.expires_at is a YYYY-MM-DD-comparable ISO
  // string; lotsExpiringWithin slices to YYYY-MM-DD for its compare.
  const now = new Date();
  const inFiveDays = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const expiresIso = inFiveDays.toISOString();

  await page.evaluate(
    async ({ exp }) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const ts = new Date().toISOString();
      const articleId = 'expiry-art';
      const variantId = 'expiry-var';
      const movId = 'expiry-mov';
      const lotId = 'expiry-lot';
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements', 'lots'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: articleId,
          internal_code: 'GR-0001',
          name: 'Almost-expired Yogurt',
          photo_id: null,
          category: 'dairy',
          colors: [],
          brand: null,
          cost_price_tnd: 800,
          sale_price_tnd: 1200,
          notes: null,
          barcode_ean: '1234567890123',
          min_stock_threshold: null,
          search_blob: 'almost-expired yogurt dairy gr-0001',
          updated_at: ts,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: variantId,
          article_id: articleId,
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: ts,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: movId,
          variant_id: variantId,
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
          id: lotId,
          variant_id: variantId,
          expires_at: exp,
          received_at: ts,
          original_quantity: 6,
          source_movement_id: movId,
          deleted_at: null,
        });
      });
      idb.close();
    },
    { exp: expiresIso },
  );
  await page.reload();

  // Search screen — banner should be visible with count "1".
  await expect(page.getByTestId('search-screen')).toBeVisible();
  const banner = page.getByTestId('expiry-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('1');

  // Tap → /expiry, the row is listed.
  await banner.click();
  await expect(page.getByTestId('expiry-screen')).toBeVisible();
  const row = page.getByTestId('expiry-row-GR-0001');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Almost-expired Yogurt');

  // Hide-7-days writes a snooze meta key that the banner predicate
  // honors. Reload — banner should be gone (the variant is silenced).
  await page.getByTestId('expiry-row-GR-0001-snooze').click();
  // Verify the meta row landed before the navigation (the IDB write
  // is awaited inside the click handler).
  const snoozedUntil = await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((r, j) => {
      dbReq.onsuccess = () => r();
      dbReq.onerror = () => j(dbReq.error);
    });
    const idb = dbReq.result;
    const tx = idb.transaction('meta', 'readonly');
    const r = tx.objectStore('meta').get('expiry_snooze_expiry-var');
    return new Promise<string | null>((res) => {
      r.onsuccess = () => res((r.result as { value?: string } | undefined)?.value ?? null);
    });
  });
  expect(snoozedUntil).toBeTruthy();
  // Should be ~7 days in the future.
  expect(new Date(snoozedUntil!).getTime()).toBeGreaterThan(now.getTime());

  await page.goto('/');
  await expect(page.getByTestId('search-screen')).toBeVisible();
  // Banner predicate filters out snoozed variants → banner gone.
  await expect(page.getByTestId('expiry-banner')).toHaveCount(0);
});

test('expiry banner does not render for non-shop verticals', async ({ page }) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Shoes Shop',
    // Default storeType (omitted) = shoes.
  });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible();
  await expect(page.getByTestId('expiry-banner')).toHaveCount(0);
});
