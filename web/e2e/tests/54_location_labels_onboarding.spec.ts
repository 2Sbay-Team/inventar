import { expect, test } from '@playwright/test';

// v0.5.2 ADR-022 — location labels customisation at onboarding. The
// Settings-side editor lands in commit 4. This test verifies the
// onboarding flow: the locations step pre-fills (vertical, locale)
// defaults; the merchant can edit; the values persist to the profile.

test.describe('Onboarding — location labels', () => {
  test('shop/en: defaults to Shelf / Stockroom; merchant override persists', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-locations')).toBeVisible();
    await expect(page.getByTestId('onb-location-floor')).toHaveValue('Shelf');
    await expect(page.getByTestId('onb-location-back')).toHaveValue('Stockroom');

    // Customise the front-of-shop label only.
    await page.getByTestId('onb-location-floor').fill('Counter');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const labels = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ floor: string; back: string }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as
              | { location_floor_label?: string; location_back_label?: string }
              | undefined;
            resolve({
              floor: row?.location_floor_label ?? '?',
              back: row?.location_back_label ?? '?',
            });
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    // Custom label survives; back falls back to the default.
    expect(labels.floor).toBe('Counter');
    expect(labels.back).toBe('Stockroom');
  });

  test('fashion/fr: defaults to Boutique / Réserve', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-fr').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-fashion').click();
    await page.getByTestId('shop-name-input').fill('Boutique Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-shoes').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-locations')).toBeVisible();
    await expect(page.getByTestId('onb-location-floor')).toHaveValue('Boutique');
    await expect(page.getByTestId('onb-location-back')).toHaveValue('Réserve');
  });

  test('shop/ar: defaults to Arabic shop labels (الرف / المخزن)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('سوبر ماركت');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-locations')).toBeVisible();
    await expect(page.getByTestId('onb-location-floor')).toHaveValue('الرف');
    await expect(page.getByTestId('onb-location-back')).toHaveValue('المخزن');
  });
});
