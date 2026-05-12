import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

test.describe('Dashboard + Expense modal', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Dashboard Test',
      locale: 'fr',
      articles: standardCatalogue,
    });
    await page.evaluate(async () => {
      await window.__inventarSeed!.sellOne('White running shoe', '42');
    });
    await page.reload();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  });

  test('renders the period selector with all 4 periods', async ({ page }) => {
    for (const id of ['period-today', 'period-week', 'period-month', 'period-year']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test('clicking a period switches it', async ({ page }) => {
    await page.getByTestId('period-month').click();
    await expect(page.getByTestId('period-month')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('period-week').click();
    await expect(page.getByTestId('period-week')).toHaveAttribute('aria-pressed', 'true');
  });

  test('today shows revenue + pairs sold reflecting the seeded sale', async ({ page }) => {
    await page.getByTestId('period-today').click();
    await expect(page.getByTestId('big-revenue')).toContainText('68');
    await expect(page.getByTestId('big-pairs')).toContainText('1');
  });

  test('add expense FAB opens the sheet, save persists', async ({ page }) => {
    await page.getByTestId('fab').click();
    await expect(page.getByTestId('expense-sheet')).toBeVisible();
    await page.getByTestId('expense-cat-rent').click();
    await page.getByTestId('expense-amount').fill('100');
    await page.getByTestId('recurring-monthly').click();
    await page.getByTestId('expense-save').click();
    await expect(page.getByTestId('expense-sheet')).toBeHidden();
    // The new expense lands in IndexedDB.
    const count = await page.evaluate(async () => {
      return new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const database = req.result;
          const tx = database.transaction('expenses', 'readonly');
          const c = tx.objectStore('expenses').count();
          c.onsuccess = () => {
            resolve(c.result);
            database.close();
          };
        };
      });
    });
    expect(count).toBe(1);
  });

  test('expense modal cancel button leaves data alone', async ({ page }) => {
    await page.getByTestId('fab').click();
    await page.getByTestId('expense-amount').fill('100');
    await page.getByTestId('expense-cancel').click();
    await expect(page.getByTestId('expense-sheet')).toBeHidden();
  });
});
