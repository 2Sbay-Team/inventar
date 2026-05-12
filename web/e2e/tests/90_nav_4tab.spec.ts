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
    for (const id of ['nav-search', 'nav-sell', 'nav-dashboard', 'nav-settings']) {
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
    for (const id of ['nav-search', 'nav-sell', 'nav-dashboard', 'nav-settings']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId('nav-list')).toHaveCount(0);
    await expect(page.getByTestId('nav-add')).toHaveCount(0);
    await expect(page.getByTestId('nav-receive')).toHaveCount(0);
  });

  test('EN labels: Articles / Sell / Dashboard / Settings', async ({ page }) => {
    await gotoSearch(page, 'en');
    // DOM holds the title-cased translation; CSS `lowercase` makes it
    // visually lowercase but Playwright reads source text. Case-insensitive
    // regex matches either.
    await expect(page.getByTestId('nav-search')).toContainText(/articles/i);
    await expect(page.getByTestId('nav-sell')).toContainText(/sell/i);
    await expect(page.getByTestId('nav-dashboard')).toContainText(/dashboard/i);
    await expect(page.getByTestId('nav-settings')).toContainText(/settings/i);
  });

  test('FR labels include the brief\'s "Bilan" (replaces Tableau de bord)', async ({ page }) => {
    await gotoSearch(page, 'fr');
    // labels are lowercased via tracking; assert case-insensitive.
    await expect(page.getByTestId('nav-search')).toContainText(/articles/i);
    await expect(page.getByTestId('nav-sell')).toContainText(/vendre/i);
    await expect(page.getByTestId('nav-dashboard')).toContainText(/bilan/i);
    await expect(page.getByTestId('nav-settings')).toContainText(/réglages/i);
  });

  test('AR labels: المنتجات / بيع / لوحة التحكم / الإعدادات', async ({ page }) => {
    await gotoSearch(page, 'ar');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByTestId('nav-search')).toContainText('المنتجات');
    await expect(page.getByTestId('nav-sell')).toContainText('بيع');
    await expect(page.getByTestId('nav-dashboard')).toContainText('لوحة التحكم');
    await expect(page.getByTestId('nav-settings')).toContainText('الإعدادات');
  });

  test('dropped routes still reachable by direct URL — /list, /add, /receive', async ({ page }) => {
    await gotoSearch(page);
    await page.goto('/list');
    await expect(page.getByTestId('list-screen')).toBeVisible({ timeout: 5_000 });
    await page.goto('/add');
    await expect(page.getByTestId('add-step-indicator')).toBeVisible({ timeout: 5_000 });
    // /receive is hideNav so no nav assertion; just confirm the
    // route mounts something recognisable.
    await page.goto('/receive');
    await expect(page.getByTestId('receive-screen')).toBeVisible({ timeout: 5_000 });
  });
});
