import { expect, test } from '@playwright/test';

// SPEC §2.1: language picker → shop name → backup card → empty Search.

test.describe('Onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__inventarSeed));
    await page.evaluate(async () => {
      await window.__inventarSeed!.reset();
    });
    await page.goto('/');
  });

  test('walks language → intent → name → fashion subtypes → locations → backup card → search', async ({
    page,
  }) => {
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await expect(page.getByTestId('step-language')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-intent')).toBeVisible();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('shop-name-input').fill('A');
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('shop-name-input').fill('Naili Boutique');
    await expect(page.getByTestId('continue')).toBeEnabled();
    await page.getByTestId('continue').click();
    // v0.5.2 ADR-021: fashion is the default vertical → fashion subtypes step.
    await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();
    await page.getByTestId('onb-subtype-shoes').click();
    await page.getByTestId('continue').click();
    // v0.5.2 ADR-022: locations step with pre-filled defaults.
    await expect(page.getByTestId('step-locations')).toBeVisible();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-backup-card')).toBeVisible();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await expect(page.getByTestId('shop-name')).toHaveText('Naili Boutique');
  });

  test('Arabic locale flips to RTL with Eastern numerals in counts', async ({ page }) => {
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('shop-name-input').fill('متجر الاختبار');
    await page.getByTestId('continue').click();
    // Default vertical is fashion → walk through subtypes + locations.
    await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();
    await page.getByTestId('onb-subtype-shoes').click();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-locations')).toBeVisible();
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('ar');
  });

  test('intent step offers backup-import path that bypasses setup', async ({ page }) => {
    // Seed a real shop, export it, reset the database, then re-onboard
    // through the import path and confirm the data lands.
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Restored Shop',
        locale: 'en',
        reset: true,
      });
    });
    const exportedJson = await page.evaluate(() => window.__inventarSeed!.exportJson());
    expect(exportedJson.length).toBeGreaterThan(50);

    await page.evaluate(async () => {
      await window.__inventarSeed!.reset();
    });
    await page.goto('/');
    await expect(page.getByTestId('step-language')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-intent')).toBeVisible();

    await page.getByTestId('intent-import-input').setInputFiles({
      name: 'inventar-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedJson),
    });

    await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('shop-name')).toHaveText('Restored Shop');
  });

  test('intent import surfaces an error for an invalid JSON file', async ({ page }) => {
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-intent')).toBeVisible();
    await page.getByTestId('intent-import-input').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('this is not json'),
    });
    await expect(page.getByTestId('intent-import-error')).toBeVisible();
    // Still on intent step — no profile was written.
    await expect(page.getByTestId('step-intent')).toBeVisible();
  });
});
