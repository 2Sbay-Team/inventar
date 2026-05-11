import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2.7 — locale coverage for the invoice flow. The original
// 64_sell_invoice_facture spec only walks the EN path. Naili's actual
// install runs in FR (and AR for a sub-segment of merchants), so we
// repeat the same flow once per non-EN locale and assert the right
// localized header label lands on /invoice/:id.

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

// Walks the sell → invoice block flow and returns once /invoice/:id is
// rendered. The customer fields and the Done button live behind the
// same testids in every locale (testids are locale-agnostic).
async function walkSellToInvoice(page: Page): Promise<void> {
  await page.goto('/sell');
  await page.getByTestId('sell-type-instead').click();
  await page.getByTestId('sell-manual-input').fill(EAN);
  await page.getByTestId('sell-manual-submit').click();
  await page.getByTestId('sell-cart-toggle').click();
  await expect(page.getByTestId('sell-cart-row-SP-0001')).toBeVisible();
  const invoiceToggle = page.getByTestId('sell-invoice-toggle');
  await invoiceToggle.scrollIntoViewIfNeeded();
  await invoiceToggle.click();
  await expect(page.getByTestId('sell-invoice-fields')).toBeVisible();
  await page.getByTestId('sell-invoice-customer-name').fill('ACME Co');
  await page.getByTestId('sell-invoice-vat').fill('19');
  await page.getByTestId('sell-done').click();
  await expect(page.getByTestId('invoice-screen')).toBeVisible();
  await expect(page.getByTestId('invoice-number')).toContainText(/INV-\d{4}-0001/);
}

test('locale=fr: invoice header renders the French title (Facture)', async ({ page }) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'fr',
    shopName: 'Facture FR',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  await seedShopWithArticle(page);
  await page.reload();
  await walkSellToInvoice(page);

  // The h2 inside /invoice/:id pulls from t('title') in the 'invoice'
  // namespace. fr.json: invoice.title === "Facture".
  await expect(page.getByTestId('invoice-screen')).toContainText('Facture');
  // Print button label is t('print'); fr: "Imprimer".
  await expect(page.getByTestId('invoice-print')).toContainText('Imprimer');
  // Share PDF label: fr "Partager PDF" — exact text from fr.json.
  await expect(page.getByTestId('invoice-share')).toContainText('Partager');
});

test('locale=ar: invoice header renders the Arabic title (فاتورة)', async ({ page }) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'ar',
    shopName: 'محل تجريبي',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  await seedShopWithArticle(page);
  await page.reload();
  await walkSellToInvoice(page);

  // The screen body must contain the Arabic title. The Arabic glyph
  // string is the verbatim ar.json invoice.title value.
  await expect(page.getByTestId('invoice-screen')).toContainText('فاتورة');
  // The screen must render right-to-left in AR locale. The <html dir>
  // attribute is what react-i18next sets at locale-switch time.
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
});
