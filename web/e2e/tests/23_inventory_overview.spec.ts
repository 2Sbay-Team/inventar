import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// Coverage for the InventoryOverview tiles, the per-vertical "Pairs/Units"
// label switch, and the printable Stock Report screen.

test.describe('Inventory overview (shoes)', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Inventory Test',
      locale: 'en',
      articles: standardCatalogue,
    });
  });

  test('dashboard inventory tiles show units, articles, and category breakdown', async ({
    page,
  }) => {
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await expect(page.getByTestId('inventory-overview')).toBeVisible();

    // standardCatalogue: White (3 units across sizes), Brown (1), Black (3) = 7.
    await expect(page.getByTestId('inv-units')).toContainText('7');
    await expect(page.getByTestId('inv-articles')).toContainText('3');
    // Bar chart is present with at least one row.
    await expect(page.getByTestId('inv-by-category')).toBeVisible();
  });

  test('shoes shop shows "Pairs in stock", not "Units in stock"', async ({ page }) => {
    await page.getByTestId('nav-dashboard').click();
    const tile = page.getByTestId('inv-units');
    await expect(tile).toContainText(/Pairs/i);
    await expect(tile).not.toContainText(/Units/i);
  });
});

test.describe('Inventory overview (kiosk — sizeless)', () => {
  test('kiosk shop shows "Units in stock", not "Pairs"', async ({ page }) => {
    // Onboard as kiosk via UI.
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-kiosk').click();
    await page.getByTestId('shop-name-input').fill('Kiosk Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('nav-dashboard').click();
    const tile = page.getByTestId('inv-units');
    await expect(tile).toContainText(/Units/i);
    await expect(tile).not.toContainText(/Pairs/i);
  });
});

test.describe('Stock report screen + print path', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Report Test',
      locale: 'en',
      articles: standardCatalogue,
    });
  });

  test('navigates from dashboard, lists every alive article with per-size counts', async ({
    page,
  }) => {
    await page.getByTestId('nav-dashboard').click();
    await page.getByTestId('open-stock-report').click();

    await expect(page.getByTestId('stock-report')).toBeVisible();
    // 3 alive articles in the standard catalogue (Black/Brown/White), so
    // we expect 3 rows.
    await expect(page.getByTestId('report-row')).toHaveCount(3);

    // White shoe has sizes 40 (1 unit) and 42 (2 units) = 3 total.
    // We assert the per-size pills and the row total in one place.
    const rows = page.getByTestId('report-row');
    const whiteRow = rows.filter({ hasText: 'White running shoe' });
    await expect(whiteRow.getByTestId('report-row-total')).toHaveText('3');
    await expect(whiteRow.getByTestId('report-row-size')).toHaveCount(2);
  });

  test('print button is wired and visible (Print / PDF)', async ({ page }) => {
    await page.getByTestId('nav-dashboard').click();
    await page.getByTestId('open-stock-report').click();
    const print = page.getByTestId('report-print');
    await expect(print).toBeVisible();
    await expect(print).toContainText(/Print/i);
  });

  test('back button returns to the previous screen', async ({ page }) => {
    await page.getByTestId('nav-dashboard').click();
    await page.getByTestId('open-stock-report').click();
    await expect(page.getByTestId('stock-report')).toBeVisible();
    await page.getByTestId('report-back').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  });
});
