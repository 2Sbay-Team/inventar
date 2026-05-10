import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.5.2 ADR-024 — per-prefix internal_code counter end-to-end. The
// kernel-level fix is unit-tested in repos/internal-code.test.ts; this
// spec exercises it through the real Add Article UI to catch the case
// where a leftover hardcoded prefix elsewhere would re-introduce the
// global-counter behaviour.

test.describe('Internal code per-prefix counter', () => {
  test('first fashion article on a profile with legacy SH-* codes gets FN-0001', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Per Prefix Fashion',
      storeType: 'fashion',
    });
    await page.reload();

    // Seed two legacy SH-* articles into the catalogue, simulating
    // the post-migration state of a shop that originally onboarded as
    // shoes pre-v9. They have the old prefix; new articles get FN.
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      function addArticle(id: string, internal_code: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
          const tx = idb.transaction(['articles', 'variants'], 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.objectStore('articles').add({
            id,
            internal_code,
            name: `Legacy ${internal_code}`,
            photo_id: null,
            category: 'casual',
            colors: [],
            brand: null,
            cost_price_tnd: 1000,
            sale_price_tnd: 2000,
            notes: null,
            barcode_ean: null,
            min_stock_threshold: null,
            expiry_alert_days: null,
            search_blob: `legacy ${internal_code}`,
            updated_at: now,
            archived_at: null,
            deleted_at: null,
          });
          tx.objectStore('variants').add({
            id: `v-${id}`,
            article_id: id,
            color: null,
            size: null,
            photo_id: null,
            hidden: false,
            updated_at: now,
            deleted_at: null,
          });
        });
      }
      await addArticle('legacy-1', 'SH-0042');
      await addArticle('legacy-2', 'SH-0099');
      idb.close();
    });

    // Open Add Article: the previewed code MUST be FN-0001 (not FN-0100,
    // which would be the pre-v9 global-counter behaviour).
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await expect(page.getByTestId('field-code')).toContainText('FN-0001');

    // Save the article and verify it actually persisted as FN-0001.
    await page.getByTestId('field-name').fill('First Fashion');
    await page.getByTestId('field-cost').fill('10000');
    await page.getByTestId('field-sale').fill('20000');
    await page.getByTestId('continue').click();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('M');
    await page.getByTestId('block-0-size-0-floor').fill('2');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const codes = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const all = await new Promise<Array<{ internal_code: string }>>((resolve, reject) => {
        const tx = idb.transaction('articles', 'readonly');
        const r = tx.objectStore('articles').getAll();
        r.onsuccess = () => resolve(r.result as Array<{ internal_code: string }>);
        r.onerror = () => reject(r.error);
      });
      idb.close();
      return all.map((a) => a.internal_code).sort();
    });
    // Three articles: the two legacy SH-* + the freshly-allocated FN-0001.
    expect(codes).toEqual(['FN-0001', 'SH-0042', 'SH-0099']);
  });

  test('first shop article on a profile with legacy GR-* codes gets SP-0001', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Per Prefix Shop',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('articles', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: 'legacy-gr',
          internal_code: 'GR-0156',
          name: 'Legacy Grocery Item',
          photo_id: null,
          category: 'drinks',
          colors: [],
          brand: null,
          cost_price_tnd: 500,
          sale_price_tnd: 1000,
          notes: null,
          barcode_ean: null,
          min_stock_threshold: null,
          expiry_alert_days: null,
          search_blob: 'legacy grocery',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
      });
      idb.close();
    });

    // Shop's primary nav has Receive instead of Add — drive to /add
    // directly (it's still routable as a deep link).
    await page.goto('/add');
    await expect(page.getByTestId('field-code')).toContainText('SP-0001');
  });
});
