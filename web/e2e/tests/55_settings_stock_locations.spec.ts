import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-022 — Settings → Stock locations editor. Onboarding-side
// label customisation is covered in 54_location_labels_onboarding;
// this spec exercises the post-onboarding edit flow + verifies the
// labels propagate to the Add Article matrix Steppers.

test.describe('Settings — Stock locations editor', () => {
  test('shop/en: rename Shelf → Counter, persists across reload + appears in Add Article', async ({
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
    await page.getByTestId('nav-settings').click();

    const section = page.getByTestId('section-stock-locations');
    await expect(section).toBeVisible();
    // Pre-filled with the shop/en defaults from the migration kernel.
    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Shelf');
    await expect(page.getByTestId('settings-location-back')).toHaveValue('Stockroom');

    // Rename the front zone. onBlur commits.
    await page.getByTestId('settings-location-floor').fill('Counter');
    await page.getByTestId('settings-location-floor').blur();
    // Back stays default.
    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Counter');

    // Reload + reopen Settings — the new label persisted.
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Counter');
    await expect(page.getByTestId('settings-location-back')).toHaveValue('Stockroom');

    // The Add Article matrix Steppers pick up the new label.
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Test item');
    await page.getByTestId('continue').click();
    // Sizeless block (shop) — labels render inside the floor/back Stepper
    // chrome via the useLocationLabels hook.
    await expect(page.getByTestId('block-0-sizeless')).toContainText('Counter');
    await expect(page.getByTestId('block-0-sizeless')).toContainText('Stockroom');
  });

  test('fashion/fr: pre-filled Boutique / Réserve; editing back zone commits', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'fr',
      shopName: 'Boutique Test',
      storeType: 'fashion',
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Boutique');
    await expect(page.getByTestId('settings-location-back')).toHaveValue('Réserve');

    await page.getByTestId('settings-location-back').fill('Stock supplémentaire');
    await page.getByTestId('settings-location-back').blur();

    const stored = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ floor: string; back: string }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const r = tx.objectStore('profile').get('singleton');
          r.onsuccess = () => {
            const row = r.result as
              | { location_floor_label?: string; location_back_label?: string }
              | undefined;
            resolve({
              floor: row?.location_floor_label ?? '?',
              back: row?.location_back_label ?? '?',
            });
          };
          r.onerror = () => reject(r.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(stored.floor).toBe('Boutique');
    expect(stored.back).toBe('Stock supplémentaire');
  });

  test('clearing a field falls back to the locale + vertical default', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Fallback Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
      locationFloorLabel: 'Custom Floor',
      locationBackLabel: 'Custom Back',
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Custom Floor');

    // Clear + blur → the commit handler treats empty as "use the
    // default" (Shelf for shop/en).
    await page.getByTestId('settings-location-floor').fill('');
    await page.getByTestId('settings-location-floor').blur();
    await expect(page.getByTestId('settings-location-floor')).toHaveValue('Shelf');
  });
});
