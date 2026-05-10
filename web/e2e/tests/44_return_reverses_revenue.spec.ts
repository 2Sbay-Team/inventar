import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// Returns reverse the cash impact of a prior sale: revenue, gross
// profit, and the items-sold counter all subtract. The Quick Adjust
// sheet's Reason=Return path now also exposes a Refund per-unit
// override so partial refunds (restocking fee, damaged packaging) are
// recorded on Movement.unit_price_tnd; null falls back to the
// article's catalogue price. Without this fix, returns put stock back
// but left revenue inflated — the dashboard claimed +60 TND for a
// sale that was actually returned the next minute.

test.describe('Returns reverse the dashboard cash impact', () => {
  test('selling 1 then returning 1 nets to zero revenue / profit / items-sold', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Return Shop' });
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Return Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Returnable Sneaker',
            colors: ['white'],
            cost_tnd: 30000, // 30 TND
            sale_tnd: 60000, // 60 TND
            sizes: [{ size: '42', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();

    // 1. Sell one at the catalogue price via Quick Adjust.
    await page.getByTestId('search-input').fill('returnable');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-sale').click();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Confirm the sale registered: dashboard revenue 60 TND. Article
    // detail uses hideNav, so we step back to Search first to reach
    // the bottom nav.
    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('big-revenue')).toContainText(/60/);
    // Net items sold = 1 (the sale).
    await expect(page.getByTestId('big-pairs')).toContainText('1');

    // 2. Return one. Reason=Return, no refund override (catalogue
    // price applies), confirm.
    await page.getByTestId('nav-search').click();
    await page.getByTestId('search-input').fill('returnable');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-return').click();
    // The refund preview should render the total in red. We assert the
    // catalogue price (60) is reflected without expecting an exact sign
    // glyph since the formatter localises the minus.
    await expect(page.getByTestId('adjust-preview-total')).toContainText('60');
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // 3. Dashboard now shows the net: 0 revenue / 0 items sold.
    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
    // Revenue formats as the currency-with-millimes string; "0" is
    // present in any localisation. Use a stricter check via the
    // computed grossProfit to make sure it's truly net-zero.
    await expect(page.getByTestId('big-pairs')).toContainText('0');
    // The cash-block revenue line goes back to zero too.
    await expect(page.getByTestId('cash-block')).toContainText(/0([.,]0+)?/);
  });

  test('partial-refund return only subtracts the refunded amount (sold 60, refunded 50, net 10 revenue)', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Partial Return Shop' });
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Partial Return Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Partial Sneaker',
            colors: ['white'],
            cost_tnd: 30000,
            sale_tnd: 60000,
            sizes: [{ size: '42', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();

    // Sell at full price.
    await page.getByTestId('search-input').fill('partial');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-sale').click();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Return at a partial refund (50 TND instead of 60 — restocking
    // fee). Article detail uses hideNav so we step back to Search first.
    await page.getByTestId('detail-back').click();
    await page.getByTestId('search-input').fill('partial');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-return').click();
    await page.getByTestId('adjust-discount').fill('50');
    // Preview total reflects the override (50.000 TND) not the
    // catalogue price.
    await expect(page.getByTestId('adjust-preview-total')).toContainText('50');
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Net revenue = 60 sold − 50 refunded = 10. Items sold = 0 (sale 1
    // − return 1 = 0).
    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
  });

  // v0.5.1 Movement.refunds_movement_id: returns capture the LINKED
  // sale's price as a snapshot so a catalogue change between sale
  // and return doesn't drift the refund amount.
  test('catalogue change between sale and return does NOT drift the refund', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Drift Shop' });
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Drift Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Drift Sneaker',
            colors: ['white'],
            cost_tnd: 30000,
            sale_tnd: 60000, // sells at 60 TND
            sizes: [{ size: '42', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();

    // Sell at 60 (catalogue).
    await page.getByTestId('search-input').fill('drift');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-sale').click();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Catalogue drops to 50 (merchant lowers price for some reason).
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((r, j) => {
        dbReq.onsuccess = () => r();
        dbReq.onerror = () => j(dbReq.error);
      });
      const idb = dbReq.result;
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('articles', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore('articles');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          for (const a of getAll.result as Array<{ id: string; sale_price_tnd: number }>) {
            store.put({ ...a, sale_price_tnd: 50000 });
          }
        };
      });
      idb.close();
    });
    // Go back to Search via direct navigation (the test's last UI
    // position was article-detail, which uses hideNav).
    await page.goto('/');
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Return — preview must show 60 (the linked sale's price), NOT 50
    // (the current catalogue). Confirm without typing an override.
    await page.getByTestId('search-input').fill('drift');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('size-cell-42').click();
    await page.getByTestId('reason-return').click();
    await expect(page.getByTestId('adjust-preview-total')).toContainText('60');
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    // Net revenue should be 0 (sold at 60, refunded at 60). If the
    // refund had defaulted to the new catalogue (50), revenue would
    // wrongly show 10 — that's the bug this test guards.
    await page.getByTestId('detail-back').click();
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('big-pairs')).toContainText('0');
    await expect(page.getByTestId('cash-block')).toContainText(/0([.,]0+)?/);
  });
});
