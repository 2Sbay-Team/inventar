import { expect, test } from '@playwright/test';

// v0.5.2 ADR-022 → v0.6 — location labels at onboarding. The picker is
// now a 3-option dropdown + "Type your own"; default selection is
// locale-only (no vertical variation) per the v0.6 brief. Test 67
// covers the fashion-vertical onboarding walk + Settings flow; this
// file covers the shop-vertical onboarding walks across the same
// three locales, exercising the shop subtypes path.

test.describe('Onboarding — location labels (shop vertical)', () => {
  test('shop/en: locale defaults render; "Type your own" lets the merchant override the floor', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-locations')).toBeVisible();
    // Locale defaults (shared across both verticals in v0.6).
    await expect(page.getByTestId('onb-location-floor-select')).toHaveValue('Shop floor');
    await expect(page.getByTestId('onb-location-back-select')).toHaveValue('Stockroom');

    // Override the floor via the "Type your own" path.
    await page.getByTestId('onb-location-floor-select').selectOption('__custom__');
    const customInput = page.getByTestId('onb-location-floor-custom-input');
    await expect(customInput).toBeVisible();
    await customInput.fill('Counter');
    await customInput.press('Tab');

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
    expect(labels.floor).toBe('Counter');
    expect(labels.back).toBe('Stockroom');
  });

  test('shop/ar: defaults to Arabic locale options (المحل / المخزن); RTL applies', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('سوبر ماركت');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-locations')).toBeVisible();
    await expect(page.getByTestId('onb-location-floor-select')).toHaveValue('المحل');
    await expect(page.getByTestId('onb-location-back-select')).toHaveValue('المخزن');
    await expect(page.getByTestId('onb-location-floor-select')).toHaveAttribute('dir', 'rtl');
  });
});
