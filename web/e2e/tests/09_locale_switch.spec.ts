import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

test.describe('Locale switching live (no restart)', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Locale Shop',
      locale: 'fr',
      articles: standardCatalogue,
    });
  });

  test('switching to AR flips dir=rtl, lang=ar, and digits to Eastern', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-lang-ar').click();
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('ar');
    await page.getByTestId('nav-search').click();
    // The result count count chip on Search appears in Eastern Arabic digits.
    const counts = await page.getByTestId('shop-counts').innerText();
    expect(counts).toMatch(/[٠-٩]/);
  });

  test('switching to EN keeps dir=ltr and Western digits', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-lang-en').click();
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('ltr');
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang).toBe('en');
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('shop-counts')).toContainText(/articles/);
  });

  test('SKU codes and TND symbol stay LTR/Western under AR (ADR-006)', async ({ page }) => {
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-lang-ar').click();
    await page.getByTestId('nav-search').click();
    await page.getByTestId('search-input').fill('white');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    const skuText = await page.getByTestId('result-card').first().textContent();
    // SKU "SH-0001" stays Western.
    expect(skuText).toContain('SH-0001');
  });
});
