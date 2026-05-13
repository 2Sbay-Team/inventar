import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2.4 ADR-024 — Facture (invoice) end-to-end.
// Walks: onboard → seed an article → /sell type-instead → toggle
// invoice block → fill customer fields → Done → land on /invoice/:id
// with subtotal/VAT/total + customer info + Print button. Then
// Settings → Past invoices → tap row → returns to the same view.

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

// v0.9.x — Sell screen no longer hosts the invoice block; that
// functionality is moving to the Documents sub-tab (placeholder for
// v0.8). The repo layer (createInvoice, invoice-pdf) and the
// /invoice/:id view still exist and are exercised by the unit tests
// in src/repos/invoices.test.ts + src/repos/invoice-pdf.test.ts.
test.skip('sell → invoice block → /invoice/:id renders subtotal/VAT/total + customer + Print', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Facture Test',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  await seedShopWithArticle(page);
  await page.reload();

  // Add the article to the cart via the manual-entry path.
  await page.goto('/sell');
  await page.getByTestId('sell-type-instead').click();
  await page.getByTestId('sell-manual-input').fill(EAN);
  await page.getByTestId('sell-manual-submit').click();

  // Open the cart drawer, tick the invoice block, fill customer fields.
  await page.getByTestId('sell-cart-toggle').click();
  await expect(page.getByTestId('sell-cart-row-SP-0001')).toBeVisible();
  // The invoice block sits below the cart total + before the action
  // buttons. On a small mobile viewport it may need a scroll to come
  // into view before the click.
  const invoiceToggle = page.getByTestId('sell-invoice-toggle');
  await invoiceToggle.scrollIntoViewIfNeeded();
  await invoiceToggle.click();
  await expect(page.getByTestId('sell-invoice-fields')).toBeVisible();
  await page.getByTestId('sell-invoice-customer-name').fill('ACME Co');
  await page.getByTestId('sell-invoice-customer-address').fill('1 rue X\n2000 Sousse');
  await page.getByTestId('sell-invoice-customer-fiscal-id').fill('1234567/A/B/000');
  // Override the VAT to 19% explicitly so the assertion is deterministic
  // even if the profile's default_vat_pct stays unset.
  await page.getByTestId('sell-invoice-vat').fill('19');

  await page.getByTestId('sell-done').click();

  // Land on /invoice/:id, see the customer block, totals, and Print button.
  await expect(page.getByTestId('invoice-screen')).toBeVisible();
  await expect(page.getByTestId('invoice-number')).toContainText(/INV-\d{4}-0001/);
  await expect(page.getByTestId('invoice-screen')).toContainText('ACME Co');
  await expect(page.getByTestId('invoice-screen')).toContainText('1234567/A/B/000');
  await expect(page.getByTestId('invoice-print')).toBeVisible();

  // Subtotal = 1 × 2000 millimes = 2 TND → formatCurrency("TND 2.000");
  // VAT = 19% × 2000 = 380 millimes → "TND 0.380"; total = 2380 millimes
  // → "TND 2.380". Decimal separator follows the active TND format.
  await expect(page.getByTestId('invoice-subtotal')).toContainText('2.000');
  await expect(page.getByTestId('invoice-vat')).toContainText('0.380');
  await expect(page.getByTestId('invoice-total')).toContainText('2.380');

  // Settings → Past invoices → row tap returns to the same invoice view.
  await page.goto('/settings');
  await page.getByTestId('settings-past-invoices').click();
  await expect(page.getByTestId('invoices-list-screen')).toBeVisible();
  const row = page.getByTestId(/invoice-row-INV-\d{4}-0001/);
  await expect(row).toBeVisible();
  await expect(row).toContainText('ACME Co');
  await row.click();
  await expect(page.getByTestId('invoice-screen')).toBeVisible();
  await expect(page.getByTestId('invoice-total')).toContainText('2.380');
});
