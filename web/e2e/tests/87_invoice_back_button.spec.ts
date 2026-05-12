import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.6 — invoice-view's Done button used to navigate('/', { replace: true })
// regardless of origin. A merchant who tapped a row in the past-invoices
// list and then Done landed on Search instead of returning to the list.
// The fix swaps to navigate(-1) so the button respects the natural
// browser history.
//
// /sell uses replace:true when navigating to /invoice/:id, so its
// own history entry is gone and `back` lands one further up the
// stack — typically /search since that's where /sell was launched
// from in the nav.

const EAN = '5449000000996';

async function seedShopWithArticle(page: Page): Promise<void> {
  await page.evaluate(async (eanValue) => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const idb = dbReq.result;
    const now = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore('articles').add({
        id: 'inv-art',
        internal_code: 'SP-0001',
        name: 'Test Cola',
        photo_id: null,
        category: 'beverages',
        colors: [],
        brand: null,
        cost_price_tnd: 1000,
        sale_price_tnd: 2000,
        notes: null,
        barcode_ean: eanValue,
        min_stock_threshold: null,
        expiry_alert_days: null,
        has_sizes: null,
        has_colors: null,
        has_expiry: null,
        unit_of_measure: 'piece',
        search_blob: 'test cola beverages sp-0001',
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: 'inv-var',
        article_id: 'inv-art',
        color: null,
        size: null,
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'inv-seed',
        variant_id: 'inv-var',
        delta: 10,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        location: 'back',
        transfer_from: null,
        transfer_to: null,
        transaction_id: null,
        expires_at: null,
        lot_id: null,
        refunds_movement_id: null,
        created_at: now,
        deleted_at: null,
      });
    });
    idb.close();
  }, EAN);
}

async function issueInvoiceViaSell(page: Page): Promise<void> {
  await page.goto('/sell');
  await page.getByTestId('sell-type-instead').click();
  await page.getByTestId('sell-manual-input').fill(EAN);
  await page.getByTestId('sell-manual-submit').click();
  await page.getByTestId('sell-cart-toggle').click();
  await expect(page.getByTestId('sell-cart-row-SP-0001')).toBeVisible();
  const invoiceToggle = page.getByTestId('sell-invoice-toggle');
  await invoiceToggle.scrollIntoViewIfNeeded();
  await invoiceToggle.click();
  await page.getByTestId('sell-invoice-customer-name').fill('Back Test Co');
  await page.getByTestId('sell-invoice-vat').fill('19');
  await page.getByTestId('sell-done').click();
  await expect(page.getByTestId('invoice-screen')).toBeVisible();
}

test.describe('v0.6.6 — invoice Done button respects history', () => {
  test('from past-invoices list: Done returns to the list, not /search', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Done Back Shop',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedShopWithArticle(page);
    await page.reload();
    await issueInvoiceViaSell(page);

    // Now navigate to /invoices the documented way and re-enter.
    await page.goto('/settings');
    await page.getByTestId('settings-past-invoices').click();
    await expect(page.getByTestId('invoices-list-screen')).toBeVisible();
    const row = page.getByTestId(/invoice-row-INV-\d{4}-0001/);
    await row.click();
    await expect(page.getByTestId('invoice-screen')).toBeVisible();

    // Done should land us on /invoices, not on /search. Previous bug:
    // navigate('/', { replace: true }) hardcoded the home route.
    await page.getByTestId('invoice-back').click();
    await expect(page.getByTestId('invoices-list-screen')).toBeVisible({ timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe('/invoices');
  });

  test('right after issuing from /sell: Done returns the merchant to /search (the sell entry point)', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Sell Back Shop',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedShopWithArticle(page);
    await page.reload();
    // /sell is launched from the bottom-nav while on /search → history:
    // [/search, /sell]. /sell `replace:true`s to /invoice/:id → history:
    // [/search, /invoice/:id]. navigate(-1) lands on /search.
    await issueInvoiceViaSell(page);
    await page.getByTestId('invoice-back').click();
    await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 5_000 });
    expect(new URL(page.url()).pathname).toBe('/');
  });
});
