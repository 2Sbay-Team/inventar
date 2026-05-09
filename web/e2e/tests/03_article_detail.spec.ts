import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// SPEC §2.3 + §2.4: tap a size cell → Quick Adjust → confirm sale →
// quantity decrements, an immutable Movement row is appended, recent
// activity updates without a navigation jump.

test.describe('Article detail + Quick Adjust', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Test Shop',
      locale: 'fr',
      articles: standardCatalogue,
    });
    await page.getByTestId('search-input').fill('white');
    // Wait for the debounce to fire and search to filter to one result.
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    await page.getByTestId('result-card').first().click();
    await expect(page.getByTestId('detail-bar')).toBeVisible();
    await expect(page.getByTestId('detail-sku')).toContainText('SH-0001');
  });

  test('renders SKU, prices, size grid, action bar', async ({ page }) => {
    await expect(page.getByTestId('detail-sku')).toContainText('SH-');
    await expect(page.getByTestId('price-cost')).toBeVisible();
    await expect(page.getByTestId('price-sale')).toBeVisible();
    await expect(page.getByTestId('size-grid')).toBeVisible();
    await expect(page.getByTestId('action-sell')).toBeVisible();
    await expect(page.getByTestId('action-restock')).toBeVisible();
  });

  test('tapping a size cell opens Quick Adjust pre-targeted to that size', async ({ page }) => {
    await page.getByTestId('size-cell-42').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeVisible();
    await expect(page.getByTestId('adjust-current')).toContainText('2');
  });

  test('confirming a sale decrements stock and appends a movement', async ({ page }) => {
    await page.getByTestId('size-cell-42').click();
    await expect(page.getByTestId('reason-sale')).toBeVisible();
    await page.getByTestId('reason-sale').click();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeHidden();
    await expect(page.getByTestId('size-42-qty')).toHaveText('1');
    // Activity feed has at least one row.
    await expect(page.getByTestId('activity-row').first()).toBeVisible();
    // Verify the movement landed in IndexedDB with delta = -1, type = sale.
    const lastMovement = await page.evaluate(async () => {
      const Dexie = (await import('/assets/index-bootstrap.js').catch(() => null)) as unknown;
      void Dexie;
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ delta: number; type: string } | null>((resolve, reject) => {
        dbReq.onerror = () => reject(dbReq.error);
        dbReq.onsuccess = () => {
          const db = dbReq.result;
          const tx = db.transaction('movements', 'readonly');
          const store = tx.objectStore('movements');
          const all = store.getAll();
          all.onsuccess = () => {
            const rows = all.result as Array<{
              delta: number;
              type: string;
              created_at: string;
            }>;
            rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
            resolve(rows[0] ? { delta: rows[0].delta, type: rows[0].type } : null);
            db.close();
          };
        };
      });
    });
    expect(lastMovement).toMatchObject({ delta: -1, type: 'sale' });
  });

  test('confirming a +2 restock raises stock by 2', async ({ page }) => {
    await page.getByTestId('action-restock').click();
    await page.getByTestId('reason-purchase').click();
    await page.getByTestId('stepper-plus').click();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeHidden();
    // size 40 had 1 → +2 → 3
    await expect(page.getByTestId('size-40-qty')).toHaveText('3');
  });

  test('cancel closes the sheet without changing stock', async ({ page }) => {
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('adjust-cancel').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeHidden();
    await expect(page.getByTestId('size-42-qty')).toHaveText('2');
  });

  test('back navigates to search screen', async ({ page }) => {
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('archive from more-menu hides the article from default search', async ({ page }) => {
    await page.getByTestId('detail-more').click();
    await page.getByTestId('menu-archive').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('search-input').fill('white');
    const cards = page.getByTestId('result-card');
    await expect(cards).toHaveCount(0);
  });

  test('delete forever requires typing DELETE', async ({ page }) => {
    await page.getByTestId('detail-more').click();
    await page.getByTestId('menu-delete').click();
    const confirmBtn = page.getByTestId('delete-confirm');
    await expect(confirmBtn).toBeDisabled();
    await page.getByTestId('delete-confirm-input').fill('NOPE');
    await expect(confirmBtn).toBeDisabled();
    await page.getByTestId('delete-confirm-input').fill('DELETE');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });
});
