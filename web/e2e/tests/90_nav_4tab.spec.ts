import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.7 ADR-037 — bottom nav collapses from 5 tabs (Search / List /
// Add / Dashboard / Settings) on fashion and 5 (Search / Receive /
// Sell / Dashboard / Settings) on shop into a single uniform 4-tab
// layout: Articles / Sell / Dashboard / Settings. This spec pins:
//
//   1. The four tabs render with the correct testids on every
//      vertical (fashion + shop), and the dropped tabs are absent.
//   2. Each tab's i18n label resolves correctly per locale, with
//      the FR / AR copy nudges from the brief (Bilan, Réglages,
//      المنتجات, لوحة التحكم, الإعدادات).
//   3. /list, /add, /receive routes still serve their components
//      via direct URL (route stays; only the nav button is gone).

async function gotoSearch(page: Page, lang: 'en' | 'fr' | 'ar' = 'en'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: '4-Tab Shop' });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
}

test.describe('v0.7 — unified 4-tab nav', () => {
  test('renders Articles / Sell / Dashboard / Settings and nothing else (fashion vertical)', async ({
    page,
  }) => {
    await gotoSearch(page);
    for (const id of ['nav-products', 'nav-sale', 'nav-reports', 'nav-settings']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    for (const id of ['nav-list', 'nav-add', 'nav-receive']) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
  });

  test('shop vertical gets the same 4 tabs (no more scan-first variant)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Shop 4-Tab',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
    for (const id of ['nav-products', 'nav-sale', 'nav-reports', 'nav-settings']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('nav-list')).toHaveCount(0);
    await expect(page.getByTestId('nav-add')).toHaveCount(0);
    await expect(page.getByTestId('nav-receive')).toHaveCount(0);
  });

  test('EN labels: Products / Sale / Reports / Settings', async ({ page }) => {
    // v0.8 — POS-standard labels (was Articles / Sell / Dashboard).
    await gotoSearch(page, 'en');
    await expect(page.getByTestId('nav-products')).toContainText(/products/i);
    await expect(page.getByTestId('nav-sale')).toContainText(/sale/i);
    await expect(page.getByTestId('nav-reports')).toContainText(/reports/i);
    await expect(page.getByTestId('nav-settings')).toContainText(/settings/i);
  });

  test('FR labels: Produits / Vente / Rapports / Réglages', async ({ page }) => {
    await gotoSearch(page, 'fr');
    await expect(page.getByTestId('nav-products')).toContainText(/produits/i);
    await expect(page.getByTestId('nav-sale')).toContainText(/vente/i);
    await expect(page.getByTestId('nav-reports')).toContainText(/rapports/i);
    await expect(page.getByTestId('nav-settings')).toContainText(/réglages/i);
  });

  test('AR labels: المنتجات / بيع / التقارير / الإعدادات', async ({ page }) => {
    await gotoSearch(page, 'ar');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByTestId('nav-products')).toContainText('المنتجات');
    await expect(page.getByTestId('nav-sale')).toContainText('بيع');
    await expect(page.getByTestId('nav-reports')).toContainText('التقارير');
    await expect(page.getByTestId('nav-settings')).toContainText('الإعدادات');
  });

  test('legacy routes redirect to new canonicals — /list → /products, /add → /products/new, /sell → /sale, /dashboard → /reports', async ({
    page,
  }) => {
    // v0.8 — paths visit the new canonical URLs via <Navigate>
    // redirects. Verified by URL after the bounce + by the
    // canonical's rendered content.
    await gotoSearch(page);

    await page.goto('/list');
    await expect(page).toHaveURL(/\/products$/, { timeout: 5_000 });
    await expect(page.getByTestId('search-screen')).toBeVisible();

    await page.goto('/add');
    await expect(page).toHaveURL(/\/products\/new$/, { timeout: 5_000 });
    await expect(page.getByTestId('add-step-indicator')).toBeVisible();

    await page.goto('/sell');
    await expect(page).toHaveURL(/\/sale$/, { timeout: 5_000 });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/reports$/, { timeout: 5_000 });
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  });
});
