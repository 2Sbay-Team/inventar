import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6 — onboarding's "Where do you keep stock?" step is now a 3-option
// localized dropdown (+ "Type your own") instead of two free-text
// inputs. Same option list across Fashion and Shop verticals; the
// merchant-stored value is the literal selected (or typed) string.

interface PersistedProfile {
  locale: string;
  location_floor_label: string;
  location_back_label: string;
}

async function readPersistedProfile(page: Page): Promise<PersistedProfile> {
  return page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    return new Promise<PersistedProfile>((resolve, reject) => {
      dbReq.onsuccess = () => {
        const idb = dbReq.result;
        const tx = idb.transaction('profile', 'readonly');
        const req = tx.objectStore('profile').get('singleton');
        req.onsuccess = () => {
          const row = req.result as
            | {
                locale?: string;
                location_floor_label?: string;
                location_back_label?: string;
              }
            | undefined;
          resolve({
            locale: row?.locale ?? '?',
            location_floor_label: row?.location_floor_label ?? '',
            location_back_label: row?.location_back_label ?? '',
          });
        };
        req.onerror = () => reject(req.error);
      };
      dbReq.onerror = () => reject(dbReq.error);
    });
  });
}

// Walks the merchant from `/` through to the locations step. The
// fashion subtypes step in between needs at least one selection.
async function walkToLocations(page: Page, langTestId: string, shopName: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId(langTestId).click();
  await page.getByTestId('intent-new').click();
  await expect(page.getByTestId('step-name')).toBeVisible();
  await page.getByTestId('onb-store-fashion').click();
  await page.getByTestId('shop-name-input').fill(shopName);
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();
  await page.getByTestId('onb-subtype-clothing_men').click();
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-locations')).toBeVisible();
}

async function finishLocations(page: Page): Promise<void> {
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-backup-card')).toBeVisible();
  await page.getByTestId('got-it').click();
  await expect(page.getByTestId('search-screen')).toBeVisible();
}

test.describe('Onboarding — localized location dropdown', () => {
  test('EN: floor default is "Shop floor", back default is "Stockroom"', async ({ page }) => {
    await walkToLocations(page, 'lang-en', 'EN Shop');

    const floorSelect = page.getByTestId('onb-location-floor-select');
    const backSelect = page.getByTestId('onb-location-back-select');
    await expect(floorSelect).toBeVisible();
    await expect(backSelect).toBeVisible();
    await expect(floorSelect).toHaveValue('Shop floor');
    await expect(backSelect).toHaveValue('Stockroom');

    await finishLocations(page);
    const profile = await readPersistedProfile(page);
    expect(profile.locale).toBe('en');
    expect(profile.location_floor_label).toBe('Shop floor');
    expect(profile.location_back_label).toBe('Stockroom');
  });

  test('FR: floor default is "Magasin", back default is "Réserve"', async ({ page }) => {
    await walkToLocations(page, 'lang-fr', 'FR Shop');

    const floorSelect = page.getByTestId('onb-location-floor-select');
    const backSelect = page.getByTestId('onb-location-back-select');
    await expect(floorSelect).toHaveValue('Magasin');
    await expect(backSelect).toHaveValue('Réserve');

    await finishLocations(page);
    const profile = await readPersistedProfile(page);
    expect(profile.locale).toBe('fr');
    expect(profile.location_floor_label).toBe('Magasin');
    expect(profile.location_back_label).toBe('Réserve');
  });

  test('AR: floor default is "المحل" + the select is RTL-aligned', async ({ page }) => {
    await walkToLocations(page, 'lang-ar', 'AR Shop');

    const floorSelect = page.getByTestId('onb-location-floor-select');
    const backSelect = page.getByTestId('onb-location-back-select');
    await expect(floorSelect).toHaveValue('المحل');
    await expect(backSelect).toHaveValue('المخزن');
    // RTL — the select carries the explicit dir attribute (resolved
    // from i18next.dir() inside SelectWithCustom).
    await expect(floorSelect).toHaveAttribute('dir', 'rtl');
    await expect(backSelect).toHaveAttribute('dir', 'rtl');
    // The page-level direction is rtl in the Arabic locale.
    const htmlDir = await page.evaluate(() => document.documentElement.dir);
    expect(htmlDir).toBe('rtl');

    await finishLocations(page);
    const profile = await readPersistedProfile(page);
    expect(profile.locale).toBe('ar');
    expect(profile.location_floor_label).toBe('المحل');
    expect(profile.location_back_label).toBe('المخزن');
  });

  test('Picking "Type your own" reveals a text input; typed value persists', async ({ page }) => {
    await walkToLocations(page, 'lang-en', 'Custom Shop');

    const floorSelect = page.getByTestId('onb-location-floor-select');
    // The native <select> exposes the option values to selectOption();
    // __custom__ is the sentinel that swaps the component to custom mode.
    await floorSelect.selectOption('__custom__');

    const customInput = page.getByTestId('onb-location-floor-custom-input');
    await expect(customInput).toBeVisible();
    await customInput.fill('Tiroir A');
    // Trigger blur so SelectWithCustom commits via its onBlur handler.
    await customInput.press('Tab');

    // The select reappears in predefined mode only when the value
    // matches one of the predefined options; "Tiroir A" doesn't,
    // so the custom input stays visible and the back select is the
    // next focusable target.
    await expect(customInput).toHaveValue('Tiroir A');

    await finishLocations(page);
    const profile = await readPersistedProfile(page);
    expect(profile.location_floor_label).toBe('Tiroir A');
    // Back stayed at its default (we didn't touch it).
    expect(profile.location_back_label).toBe('Stockroom');
  });

  test('Settings → Stock locations uses the same SelectWithCustom; edits persist', async ({
    page,
  }) => {
    // Seed an EN/fashion profile so we land straight in the app.
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Test Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    const floorSelect = page.getByTestId('settings-location-floor-select');
    const backSelect = page.getByTestId('settings-location-back-select');
    await expect(floorSelect).toBeVisible();
    await expect(backSelect).toBeVisible();

    // The seeded profile carries the v8→v9 migration default for
    // fashion+EN, which is "Shop floor" — already in the new option
    // list, so the dropdown renders in predefined mode.
    await expect(floorSelect).toHaveValue('Shop floor');

    // Switch to a different predefined option.
    await floorSelect.selectOption('Display');
    await expect(floorSelect).toHaveValue('Display');

    // SelectWithCustom commits onChange synchronously; give the
    // upsertProfile + use-live subscription a tick to settle, then
    // confirm the underlying profile row was rewritten.
    await expect
      .poll(async () => (await readPersistedProfile(page)).location_floor_label)
      .toBe('Display');

    // Pick "Type your own" → input appears → type → blur → persisted.
    await backSelect.selectOption('__custom__');
    const customBack = page.getByTestId('settings-location-back-custom-input');
    await expect(customBack).toBeVisible();
    await customBack.fill('Cave');
    await customBack.press('Tab');
    await expect
      .poll(async () => (await readPersistedProfile(page)).location_back_label)
      .toBe('Cave');
  });
});
