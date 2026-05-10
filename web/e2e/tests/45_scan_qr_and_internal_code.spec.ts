import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.1: in-app scanner accepts three input shapes — EAN (existing,
// covered by tests 36-39), Inventar's own /article/<uuid> QR (printed
// shelf labels), and merchant-printed internal_code (Code-128/Code-39).
// This spec exercises the two new paths in /receive and /sell, plus
// the unknown-internal-code rejection toast.

const ARTICLE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const VARIANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeefa';
const INTERNAL_CODE = 'GR-0042';
const EAN = '5449000000996';

async function seedKnownArticle(page: Page): Promise<void> {
  await page.evaluate(
    async (args) => {
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
          id: args.articleId,
          internal_code: args.internalCode,
          name: 'Coca-Cola 33cl',
          photo_id: null,
          category: 'beverages',
          colors: [],
          brand: 'Coca-Cola',
          cost_price_tnd: 1000,
          sale_price_tnd: 1500,
          notes: null,
          barcode_ean: args.ean,
          min_stock_threshold: null,
          search_blob: 'coca-cola 33cl coca-cola beverages gr-0042',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: args.variantId,
          article_id: args.articleId,
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'seed-purchase',
          variant_id: args.variantId,
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
    },
    { articleId: ARTICLE_ID, variantId: VARIANT_ID, internalCode: INTERNAL_CODE, ean: EAN },
  );
}

test.describe('Scanner accepts Inventar QR URL + internal_code', () => {
  test('/receive: QR-URL scan → known sheet for that article', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Receive QR',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedKnownArticle(page);
    await page.reload();

    await page.goto('/receive');
    await expect(page.getByTestId('receive-screen')).toBeVisible();

    // Inventar QR encodes the production-origin URL; scanning it
    // in-app must short-circuit to the same article without leaving
    // the screen.
    const qrUrl = `https://inventar.hoodhood.ai/article/${ARTICLE_ID}`;
    await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), qrUrl);

    const sheet = page.getByTestId('receive-known-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Coca-Cola 33cl');
    await expect(sheet).toContainText(INTERNAL_CODE);
    await expect(page.getByTestId('receive-known-stock')).toContainText('10');
  });

  test('/receive: internal_code scan → known sheet for that article', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Receive Internal',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedKnownArticle(page);
    await page.reload();

    await page.goto('/receive');
    await expect(page.getByTestId('receive-screen')).toBeVisible();

    // A merchant-printed Code-128 of the article's internal_code
    // resolves the same article as an EAN scan would.
    await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), INTERNAL_CODE);

    const sheet = page.getByTestId('receive-known-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Coca-Cola 33cl');
    await expect(sheet).toContainText(INTERNAL_CODE);
  });

  test('/receive: unknown internal_code → toast, no auto-create-new flow', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Receive Missing',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    // No article seeded — internal-code lookup must miss and show toast.

    await page.goto('/receive');
    await expect(page.getByTestId('receive-screen')).toBeVisible();

    await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), 'GR-DOES-NOT-EXIST');
    // Expect the scan_not_found toast; the "unknown EAN → mini-form
    // for new product" path must NOT trigger (we only auto-create
    // from EAN scans, never from non-EAN).
    await expect(page.getByTestId('receive-scan-error')).toContainText('Article not found');
    await expect(page.getByTestId('receive-unknown-sheet')).toHaveCount(0);
  });

  test('/sell: QR-URL scan → adds the article to cart', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Sell QR',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedKnownArticle(page);
    await page.reload();

    await page.goto('/sell');
    await expect(page.getByTestId('sell-screen')).toBeVisible();

    const qrUrl = `https://inventar.hoodhood.ai/article/${ARTICLE_ID}`;
    await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), qrUrl);

    // Cart pill bumps to 1 item.
    await expect(page.getByTestId('sell-cart-toggle')).toContainText('1');
  });

  test('/sell: internal_code scan → adds the article to cart', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Sell Internal',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await seedKnownArticle(page);
    await page.reload();

    await page.goto('/sell');
    await expect(page.getByTestId('sell-screen')).toBeVisible();

    await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), INTERNAL_CODE);

    await expect(page.getByTestId('sell-cart-toggle')).toContainText('1');
  });
});
