import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-022 → v0.6 — Settings → Stock locations editor. The
// onboarding-side dropdown is covered in 67_locations_dropdown; this
// spec exercises post-onboarding editing AND the propagation path:
// a label edited in Settings must surface in the Add Article matrix
// Steppers via the useLocationLabels() hook.

test.describe('Settings — Stock locations editor', () => {
  test('shop/en: legacy "Shelf" opens in custom mode, edit propagates to Add Article', async ({
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
    // Migration default for shop+en is "Shelf" — not in the new
    // dropdown's EN option list (Shop floor / Display / Front), so the
    // component renders in custom mode with the legacy value pre-filled.
    const floorCustom = page.getByTestId('settings-location-floor-custom-input');
    await expect(floorCustom).toBeVisible();
    await expect(floorCustom).toHaveValue('Shelf');
    // Back ("Stockroom") IS in the new EN back list, so it renders in
    // predefined-select mode.
    await expect(page.getByTestId('settings-location-back-select')).toHaveValue('Stockroom');

    // Rename the front zone to "Counter" via the custom-mode input.
    await floorCustom.fill('Counter');
    await floorCustom.press('Tab');
    await expect(floorCustom).toHaveValue('Counter');

    // Reload + reopen Settings — the new label persisted.
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue('Counter');
    await expect(page.getByTestId('settings-location-back-select')).toHaveValue('Stockroom');

    // The Add Article matrix Steppers pick up the new label (via the
    // useLocationLabels() hook reading the persisted profile).
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Test item');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('block-0-sizeless')).toContainText('Counter');
    await expect(page.getByTestId('block-0-sizeless')).toContainText('Stockroom');
  });

  test('fashion/fr: predefined defaults; switching to another predefined commits', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'fr',
      shopName: 'Boutique Test',
      storeType: 'fashion',
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // Migration defaults for fashion+fr ("Boutique" / "Réserve") are
    // both in the new FR option lists, so both render in select mode.
    await expect(page.getByTestId('settings-location-floor-select')).toHaveValue('Boutique');
    await expect(page.getByTestId('settings-location-back-select')).toHaveValue('Réserve');

    // Switch back to another predefined option ("Stock").
    await page.getByTestId('settings-location-back-select').selectOption('Stock');

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
    expect(stored.back).toBe('Stock');
  });
});
