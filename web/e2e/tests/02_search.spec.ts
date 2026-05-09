import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

test.describe('Search screen — buttons + nav', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Naili Shoes',
      locale: 'fr',
      articles: standardCatalogue,
    });
  });

  test('bottom nav has all 5 tabs and they navigate', async ({ page }) => {
    await expect(page.getByTestId('bottom-nav')).toBeVisible();
    for (const id of ['nav-search', 'nav-list', 'nav-add', 'nav-dashboard', 'nav-settings']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await page.getByTestId('nav-list').click();
    await expect(page.getByTestId('list-screen')).toBeVisible();
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('nav-add').click();
    await expect(page.getByTestId('add-cancel')).toBeVisible();
    await page.getByTestId('add-cancel').click();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
  });

  test('recent search chips populate and re-fill the search input', async ({ page }) => {
    await page.getByTestId('search-input').fill('white');
    // Recent push debounces 600ms — wait for the chip to land.
    await expect(page.getByTestId('recent-chip').first()).toBeVisible({ timeout: 4_000 });
    // Clear and let the debounce fully settle before clicking the chip.
    await page.getByTestId('search-input').fill('brown');
    await expect(page.getByTestId('search-input')).toHaveValue('brown');
    await page.waitForTimeout(200); // > 150 ms debounce
    await page.getByTestId('recent-chip').first().click();
    await expect(page.getByTestId('search-input')).toHaveValue('white');
  });

  test('result card tap navigates to article detail', async ({ page }) => {
    await page.getByTestId('search-input').fill('white');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    await page.getByTestId('result-card').first().click();
    await expect(page.getByTestId('detail-bar')).toBeVisible();
  });

  test('counts in the header reflect seeded data', async ({ page }) => {
    await expect(page.getByTestId('shop-counts')).toContainText('3');
  });
});
