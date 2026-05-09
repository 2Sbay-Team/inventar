import { expect, test } from '@playwright/test';
import { onboardViaUI } from '../helpers/onboarding';

// Multi-vertical (StoreType) coverage — onboarding step 2 lets the user
// pick a shop type. Sizeless types (kiosk / grocery) skip the size grid
// entirely and let the user manage stock as a single unit per article.

test.describe('Multi-vertical store types', () => {
  test('onboarding step 2 renders 4 store-type cards', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-name')).toBeVisible();

    // The 4 cards are present and clickable.
    for (const code of ['shoes', 'clothes', 'kiosk', 'grocery']) {
      await expect(page.getByTestId(`onb-store-${code}`)).toBeVisible();
    }
  });

  test('selecting kiosk persists to ShopProfile.store_type after onboarding', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-name')).toBeVisible();

    await page.getByTestId('onb-store-kiosk').click();
    await page.getByTestId('shop-name-input').fill('Kiosk Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Read it back from IndexedDB via the seed surface.
    const storeType = await page.evaluate(async () => {
       
      const dbReq = indexedDB.open('inventar');
      return new Promise<string>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const tx = db.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () =>
            resolve((req.result as { store_type?: string } | undefined)?.store_type ?? 'unknown');
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(storeType).toBe('kiosk');
  });

  test('default selection is shoes — categories show shoe options', async ({ page }) => {
    await page.goto('/');
    await onboardViaUI(page, { lang: 'en', shopName: 'Default Shop' });
    await page.getByTestId('nav-add').click();

    // Default shoe categories should be present (sport / dress / casual).
    await expect(page.getByTestId('category-sport')).toBeVisible();
    await expect(page.getByTestId('category-dress')).toBeVisible();
    await expect(page.getByTestId('category-casual')).toBeVisible();
    // Sizes input should also be visible (sized store).
    await expect(page.getByTestId('field-sizes')).toBeVisible();
  });
});

test.describe('Sizeless mode (kiosk)', () => {
  test('Add Article hides sizes and shows kiosk categories', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await page.getByTestId('onb-store-kiosk').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    await page.getByTestId('nav-add').click();

    // Sizes input must be gone for kiosk.
    await expect(page.getByTestId('field-sizes')).toHaveCount(0);

    // Kiosk-specific categories should be present.
    await expect(page.getByTestId('category-drinks')).toBeVisible();
    await expect(page.getByTestId('category-snacks')).toBeVisible();
    await expect(page.getByTestId('category-tobacco')).toBeVisible();

    // Shoe categories must NOT be present.
    await expect(page.getByTestId('category-sport')).toHaveCount(0);
  });
});
