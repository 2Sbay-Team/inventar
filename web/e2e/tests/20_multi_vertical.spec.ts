import { expect, test } from '@playwright/test';
import { onboardViaUI } from '../helpers/onboarding';

// Multi-vertical (StoreType) coverage — onboarding step 2 lets the user
// pick a shop type. v0.5 (ADR-017) merged 'kiosk' and 'grocery' into
// 'shop', so the picker now offers 3 cards instead of 4. The shop card
// covers every sizeless/colorless small-format vertical (kiosk, grocery,
// minimarket, parapharma, stationery — see commit 2 for the sub-types
// step that further differentiates them).

test.describe('Multi-vertical store types', () => {
  test('onboarding step 2 renders 3 store-type cards (shop replaces kiosk + grocery)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();

    for (const code of ['shoes', 'clothes', 'shop']) {
      await expect(page.getByTestId(`onb-store-${code}`)).toBeVisible();
    }
    // Old kiosk and grocery chips must be gone.
    await expect(page.getByTestId('onb-store-kiosk')).toHaveCount(0);
    await expect(page.getByTestId('onb-store-grocery')).toHaveCount(0);
  });

  test('selecting shop persists to ShopProfile.store_type after onboarding', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();

    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Shop Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

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
    expect(storeType).toBe('shop');
  });

  test('default selection is shoes — categories show shoe options', async ({ page }) => {
    await page.goto('/');
    await onboardViaUI(page, { lang: 'en', shopName: 'Default Shop' });
    await page.getByTestId('nav-add').click();

    // Default shoe categories should be present (sport / dress / casual).
    await expect(page.getByTestId('category-sport')).toBeVisible();
    await expect(page.getByTestId('category-dress')).toBeVisible();
    await expect(page.getByTestId('category-casual')).toBeVisible();
    // Sized vertical: Step 2 surfaces the size-row input.
    await page.getByTestId('field-name').fill('Sized check');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('block-0-size-0-input')).toBeVisible();
  });
});

test.describe('Switching store type from Settings', () => {
  test('select shop in Settings → confirm warning → store_type updates', async ({ page }) => {
    // Start as a shoes shop (default).
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await page.getByTestId('shop-name-input').fill('Type Switcher');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Settings → Shop profile → store-type select.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    await page.getByTestId('settings-store-type').selectOption('shop');

    await expect(page.getByTestId('store-type-confirm')).toBeVisible();
    await page.getByTestId('store-type-confirm-btn').click();
    await expect(page.getByTestId('store-type-confirm')).toHaveCount(0);

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
    expect(storeType).toBe('shop');

    // Add Article should now hide sizes (shop is sizeless): Step 2 renders
    // the sizeless floor/back pair, no size-row input.
    await page.getByTestId('nav-add').click();
    await page.getByTestId('field-name').fill('Sizeless check');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('block-0-sizeless')).toBeVisible();
    await expect(page.getByTestId('block-0-size-0-input')).toHaveCount(0);
  });

  test('cancel button on store-type warning leaves type unchanged', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('shop-name-input').fill('Cancel Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-store-type').selectOption('shop');
    await expect(page.getByTestId('store-type-confirm')).toBeVisible();
    await page.getByTestId('store-type-cancel').click();
    await expect(page.getByTestId('store-type-confirm')).toHaveCount(0);

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
    expect(storeType).toBe('shoes');
  });
});

test.describe('Sizeless mode (shop)', () => {
  test('Add Article hides sizes for shop vertical', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    await page.getByTestId('nav-add').click();

    // Shoe categories must NOT be present (Step 1 chips reflect the shop
    // category list).
    await expect(page.getByTestId('category-sport')).toHaveCount(0);

    // Step 2: sizeless floor/back pair, no size-row input.
    await page.getByTestId('field-name').fill('Sizeless check');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('block-0-sizeless')).toBeVisible();
    await expect(page.getByTestId('block-0-size-0-input')).toHaveCount(0);
  });
});
