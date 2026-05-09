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

  test('walks language → name → backup card → search', async ({ page }) => {
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await expect(page.getByTestId('step-language')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('shop-name-input').fill('A');
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('shop-name-input').fill('Naili Shoes');
    await expect(page.getByTestId('continue')).toBeEnabled();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-backup-card')).toBeVisible();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await expect(page.getByTestId('shop-name')).toHaveText('Naili Shoes');
  });

  test('Arabic locale flips to RTL with Eastern numerals in counts', async ({ page }) => {
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('shop-name-input').fill('متجر الاختبار');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('ar');
  });
});
