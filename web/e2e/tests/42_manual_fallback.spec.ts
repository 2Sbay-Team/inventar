import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-018: /sell's "Type instead" path. Typing a 12/13-digit EAN
// short-circuits to the same handler the camera would use; typing a
// non-barcode string runs a name/internal-code/EAN-substring search
// against the catalogue and lets the merchant tap a result. Either way
// the cart row that gets added is identical to a camera scan.

// v0.9.x — "Type instead" sheet was replaced by a search-first input
// bar. New equivalents tested in 94_sell_session_flow.spec.ts.
test.skip('sell: Type instead → typing the full EAN of a known article adds the same cart row as a scan', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Manual Fallback',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  const ean = '5449000000996';
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
        id: 'man-art',
        internal_code: 'GR-0001',
        name: 'Manual Coke',
        photo_id: null,
        category: 'beverages',
        colors: [],
        brand: null,
        cost_price_tnd: 1000,
        sale_price_tnd: 1500,
        notes: null,
        barcode_ean: eanValue,
        min_stock_threshold: null,
        search_blob: 'manual coke beverages gr-0001',
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: 'man-var',
        article_id: 'man-art',
        color: null,
        size: null,
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'man-seed',
        variant_id: 'man-var',
        delta: 5,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        location: 'back',
        transfer_from: null,
        transfer_to: null,
        transaction_id: null,
        expires_at: null,
        lot_id: null,
        created_at: now,
        deleted_at: null,
      });
    });
    idb.close();
  }, ean);
  await page.reload();

  await page.goto('/sell');
  await expect(page.getByTestId('sell-screen')).toBeVisible();
  // Open Type-instead, type the full EAN, submit.
  await page.getByTestId('sell-type-instead').click();
  await expect(page.getByTestId('sell-manual-sheet')).toBeVisible();
  await page.getByTestId('sell-manual-input').fill(ean);
  await page.getByTestId('sell-manual-submit').click();
  await expect(page.getByTestId('sell-manual-sheet')).toHaveCount(0);

  // The cart should now contain the article — same shape a scan would
  // have produced. Open and check.
  await page.getByTestId('sell-cart-toggle').click();
  const row = page.getByTestId('sell-cart-row-GR-0001');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Manual Coke');
  await expect(row).toContainText('×1');
  await page.getByTestId('sell-done').click();
  await expect(page).toHaveURL(/\/$/);

  // One sale Movement exists.
  const sales = await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const idb = dbReq.result;
    const movements = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('movements', 'readonly');
      const r = tx.objectStore('movements').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return (movements as Array<{ type: string; delta: number; deleted_at: string | null }>).filter(
      (m) => m.type === 'sale' && m.deleted_at === null,
    );
  });
  expect(sales.length).toBe(1);
  expect(sales[0]!.delta).toBe(-1);
});

// v0.9.x — "Type instead" sheet was replaced by a search-first input
// bar. New equivalents tested in 94_sell_session_flow.spec.ts.
test.skip('sell: Type instead → name search finds the article and tapping the result adds it', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Manual Search',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  await page.evaluate(async () => {
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
        id: 'srch-art',
        internal_code: 'GR-0001',
        name: 'Searchable Snack',
        photo_id: null,
        category: 'snacks',
        colors: [],
        brand: null,
        cost_price_tnd: 600,
        sale_price_tnd: 1000,
        notes: null,
        barcode_ean: '7622210449283',
        min_stock_threshold: null,
        search_blob: 'searchable snack snacks gr-0001',
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: 'srch-var',
        article_id: 'srch-art',
        color: null,
        size: null,
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'srch-seed',
        variant_id: 'srch-var',
        delta: 3,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        location: 'back',
        transfer_from: null,
        transfer_to: null,
        transaction_id: null,
        expires_at: null,
        lot_id: null,
        created_at: now,
        deleted_at: null,
      });
    });
    idb.close();
  });
  await page.reload();

  await page.goto('/sell');
  await expect(page.getByTestId('sell-screen')).toBeVisible();
  await page.getByTestId('sell-type-instead').click();
  await page.getByTestId('sell-manual-input').fill('Searchable');
  await page.getByTestId('sell-manual-submit').click();
  // No barcode-shaped input → renders results list.
  await expect(page.getByTestId('sell-manual-results')).toBeVisible();
  await page.getByTestId('sell-manual-result-GR-0001').click();
  await expect(page.getByTestId('sell-manual-sheet')).toHaveCount(0);

  await page.getByTestId('sell-cart-toggle').click();
  await expect(page.getByTestId('sell-cart-row-GR-0001')).toBeVisible();
});
