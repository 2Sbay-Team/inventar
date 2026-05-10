import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// Last commit added a per-Movement `unit_price_tnd` override and
// taught the dashboard to honour it in revenue + gross-profit math.
// The unit tests cover the math; this proves it end-to-end through the
// real UI: open Quick Adjust, enter a discounted sale price, confirm,
// then check the dashboard shows the override (not the catalogue price).

test.describe('Sale-time discount affects dashboard math', () => {
  test('selling at 40 TND with a 60 TND article yields 40 TND revenue, 10 TND gross', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Discount Shop' });

    // Seed one article: cost 30 TND, sale 60 TND, 5 in size 42.
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Discount Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Override Trainer',
            colors: ['white'],
            cost_tnd: 30000,
            sale_tnd: 60000,
            sizes: [{ size: '42', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Drive a sale at a discounted price via the UI.
    await page.getByTestId('search-input').fill('override');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeVisible();

    // Default reason is 'sale' — discount input visible.
    await expect(page.getByTestId('adjust-discount')).toBeVisible();
    await page.getByTestId('adjust-discount').fill('40');
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Stock dropped from 5 to 4.
    await expect(page.getByTestId('stock-total')).toContainText('4');

    // Dashboard should show 40 TND revenue, not 60 TND.
    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await page.getByTestId('period-today').click();

    // formatCurrency renders integers like "TND 40.000" in en locale
    // (TND has 3 decimal digits). Match the integer part to be lenient
    // about non-breaking spaces between code and number.
    const revenueText = (await page.getByTestId('big-revenue').textContent()) ?? '';
    expect(revenueText).toMatch(/40[.,]000/);
    expect(revenueText, 'revenue must use the override, not catalogue 60 TND').not.toMatch(
      /60[.,]000/,
    );

    // Gross profit = override (40) - cost (30) = 10 TND. (Net subtracts
    // expenses; with no expenses, big-profit shows the net which equals
    // gross here.)
    const profitText = (await page.getByTestId('big-profit').textContent()) ?? '';
    expect(profitText).toMatch(/10[.,]000/);
    expect(profitText, 'profit must reflect the override, not catalogue gross 30 TND').not.toMatch(
      /30[.,]000/,
    );

    // Sanity: verify the movement actually has unit_price_tnd=40000 in DB.
    const moveOverride = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const movements = await new Promise<
        Array<{ delta: number; type: string; unit_price_tnd: number | null }>
      >((resolve, reject) => {
        const req = db.transaction('movements', 'readonly').objectStore('movements').getAll();
        req.onsuccess = () =>
          resolve(
            req.result as Array<{ delta: number; type: string; unit_price_tnd: number | null }>,
          );
        req.onerror = () => reject(req.error);
      });
      db.close();
      return movements.find((m) => m.type === 'sale')?.unit_price_tnd ?? null;
    });
    expect(moveOverride).toBe(40000);
  });

  test('sale without a discount falls back to the catalogue sale price', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'No Discount Shop' });
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'No Discount Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Catalogue Trainer',
            colors: ['white'],
            cost_tnd: 30000,
            sale_tnd: 60000,
            sizes: [{ size: '42', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();
    await page.getByTestId('search-input').fill('catalogue');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await expect(page.getByTestId('adjust-discount')).toBeVisible();
    // Discount left empty.
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
    await page.getByTestId('period-today').click();
    const revenueText = (await page.getByTestId('big-revenue').textContent()) ?? '';
    expect(revenueText).toMatch(/60[.,]000/);

    const moveOverride = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const movements = await new Promise<Array<{ type: string; unit_price_tnd: number | null }>>(
        (resolve, reject) => {
          const req = db.transaction('movements', 'readonly').objectStore('movements').getAll();
          req.onsuccess = () =>
            resolve(req.result as Array<{ type: string; unit_price_tnd: number | null }>);
          req.onerror = () => reject(req.error);
        },
      );
      db.close();
      return movements.find((m) => m.type === 'sale')?.unit_price_tnd ?? null;
    });
    // v0.5.1: even without an explicit discount, sales now SNAPSHOT
    // the catalogue price at sale time (60_000 millimes here). This
    // changed in the returns-linkage commit so that a future return
    // can refund the exact original amount even if the catalogue
    // changes later. The dashboard math is unaffected — it already
    // honoured `unit_price_tnd ?? article.sale_price_tnd`.
    expect(moveOverride).toBe(60000);
  });
});
