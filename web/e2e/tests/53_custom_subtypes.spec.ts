import { expect, test, type Page } from '@playwright/test';

// v0.5.2 ADR-018 — custom subtypes (free strings up to 30 chars). Both
// fashion and shop verticals expose the inline "+ Add another category"
// affordance; custom strings round-trip into ShopProfile.shop_subtypes /
// fashion_subtypes verbatim. Existing-profile legacy keys also surface
// as removable chips (covered in commit 4 / Settings tests).

test.describe('Custom subtypes — onboarding', () => {
  async function startOnboarding(
    page: Page,
    storeType: 'fashion' | 'shop',
    name: string,
  ): Promise<void> {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId(`onb-store-${storeType}`).click();
    await page.getByTestId('shop-name-input').fill(name);
    await page.getByTestId('continue').click();
  }

  test('shop: type a custom subtype "tabac" → chip appears + continue enables', async ({
    page,
  }) => {
    await startOnboarding(page, 'shop', 'Custom Shop');
    await expect(page.getByTestId('step-shop-subtypes')).toBeVisible();

    // Continue starts disabled (no selection at all).
    await expect(page.getByTestId('continue')).toBeDisabled();

    // Open the custom-add input.
    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('tabac');
    await page.getByTestId('onb-custom-save').click();

    // Custom chip rendered + Continue enabled (custom counts toward
    // the ≥1 selection requirement).
    await expect(page.getByTestId('onb-custom-chip-tabac')).toBeVisible();
    await expect(page.getByTestId('continue')).toBeEnabled();

    // Add a second custom + remove the first to prove the affordance.
    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('halal_meat');
    await page.getByTestId('onb-custom-save').click();
    await expect(page.getByTestId('onb-custom-chip-halal_meat')).toBeVisible();

    await page.getByTestId('onb-custom-remove-tabac').click();
    await expect(page.getByTestId('onb-custom-chip-tabac')).toHaveCount(0);

    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-locations')).toBeVisible();
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Storage check: shop_subtypes contains the custom string verbatim.
    const subs = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<string[]>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as { shop_subtypes?: string[] } | undefined;
            resolve(row?.shop_subtypes ?? []);
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(subs).toEqual(['halal_meat']);
  });

  test('fashion: custom subtype works the same way', async ({ page }) => {
    await startOnboarding(page, 'fashion', 'Custom Fashion');
    await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();

    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('hijab_modest');
    await page.getByTestId('onb-custom-save').click();
    await expect(page.getByTestId('onb-custom-chip-hijab_modest')).toBeVisible();

    await page.getByTestId('continue').click();
    await page.getByTestId('continue').click(); // locations defaults
    await page.getByTestId('got-it').click();

    const subs = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<string[]>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as { fashion_subtypes?: string[] } | undefined;
            resolve(row?.fashion_subtypes ?? []);
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(subs).toEqual(['hijab_modest']);
  });

  test('cancel + escape both back out of the custom input', async ({ page }) => {
    await startOnboarding(page, 'fashion', 'Cancel Test');

    // Cancel button.
    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('whatever');
    await page.getByTestId('onb-custom-cancel').click();
    await expect(page.getByTestId('onb-custom-input')).toHaveCount(0);
    await expect(page.getByTestId('onb-custom-chip-whatever')).toHaveCount(0);

    // Escape key.
    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('also_whatever');
    await page.getByTestId('onb-custom-input').press('Escape');
    await expect(page.getByTestId('onb-custom-input')).toHaveCount(0);
  });
});
