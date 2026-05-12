import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.3 ADR-029 amendment — predefined location labels are stored as
// locale-neutral keys (`shop_floor` / `display` / …), and
// useLocationLabels resolves them to the current locale's display
// at render time. Custom-typed values persist with a `custom:`
// prefix and render verbatim across all locales.
//
// Specs in 75 / 78 / 79 already pin the per-screen behaviour; this
// file covers the end-to-end locale-swap contract — the bug merchants
// reported where a value picked in one locale rendered as raw foreign
// text after switching language.

async function selectValue(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => (el as HTMLSelectElement).value);
}

test.describe('v0.6.3 — predefined option follows UI locale across language switches', () => {
  test('Pick "Magasin" in FR → swap to EN shows "Shop floor" → swap to AR shows "المحل"', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'fr',
      shopName: 'Locale Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // FR: dropdown shows Magasin/Boutique/Comptoir. Pick "Magasin"
    // explicitly so the test doesn't lean on the seeded default.
    const floorFr = page.getByTestId('settings-location-floor-select');
    await expect(floorFr).toBeVisible();
    await floorFr.selectOption('Magasin');
    await expect(floorFr).toHaveValue('Magasin');

    // Swap to EN — same key, dropdown re-renders with the EN display.
    await page.getByTestId('settings-lang-en').click();
    const floorEn = page.getByTestId('settings-location-floor-select');
    await expect(floorEn).toBeVisible();
    expect(await selectValue(page, 'settings-location-floor-select')).toBe('Shop floor');

    // Swap to AR — same key, AR display.
    await page.getByTestId('settings-lang-ar').click();
    const floorAr = page.getByTestId('settings-location-floor-select');
    await expect(floorAr).toBeVisible();
    expect(await selectValue(page, 'settings-location-floor-select')).toBe('المحل');
    // Page direction follows AR.
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  });

  test('Custom value typed in EN renders verbatim in FR and AR', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Custom Survive Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // Type custom value in EN.
    await page.getByTestId('settings-location-floor-select').selectOption('__custom__');
    const customInput = page.getByTestId('settings-location-floor-custom-input');
    await customInput.fill('Tiroir A');
    await customInput.press('Tab');
    // The custom-input stays visible because the value is not in any
    // locale's predefined list. UI shows the verbatim typed string.
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue('Tiroir A');

    // Swap to FR — value preserved verbatim, still in custom mode.
    await page.getByTestId('settings-lang-fr').click();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue('Tiroir A');

    // Swap to AR — same.
    await page.getByTestId('settings-lang-ar').click();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue('Tiroir A');
  });

  test('Legacy display-string profile (pre-migration) renders the right locale after the v13 upgrade', async ({
    page,
  }) => {
    // Seed with an AR display string (the v0.6.2 storage shape).
    // The Dexie v12 → v13 upgrade runs on db.open(), rewriting the
    // value to the canonical key — useLocationLabels then resolves
    // it for the current locale.
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'ar',
      shopName: 'Pre-Migration Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
      locationFloorLabel: 'الواجهة', // AR display for the `display` key
      locationBackLabel: 'المستودع', // AR display for the `back` key
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // AR: dropdown values match what the merchant originally picked.
    expect(await selectValue(page, 'settings-location-floor-select')).toBe('الواجهة');
    expect(await selectValue(page, 'settings-location-back-select')).toBe('المستودع');

    // EN: same keys, EN displays.
    await page.getByTestId('settings-lang-en').click();
    expect(await selectValue(page, 'settings-location-floor-select')).toBe('Display');
    expect(await selectValue(page, 'settings-location-back-select')).toBe('Back');

    // FR: same keys, FR displays.
    await page.getByTestId('settings-lang-fr').click();
    expect(await selectValue(page, 'settings-location-floor-select')).toBe('Boutique');
    expect(await selectValue(page, 'settings-location-back-select')).toBe('Arrière');
  });
});
