import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.9.x — the cart-based /sale flow this spec was written against no
// longer exists (one Movement per Confirm, no cart drawer). The
// shared-transaction_id-per-session invariant is now covered by
// 94_sell_session_flow.spec.ts. Skipping here until a parity rewrite
// lands.
test.skip('sell: scan A twice + B once → cart has 2 rows; Done writes 2 sale movements (deltas -2, -1) with shared transaction_id', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Sell Cart',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  // Seed two articles with EANs and stock=10 each.
  const eanA = '5449000000996';
  const eanB = '6111035000018';
  await page.evaluate(
    async ([a, b]) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      const seed = (id: string, code: string, name: string, ean: string, sale: number) => ({
        article: {
          id,
          internal_code: code,
          name,
          photo_id: null,
          category: 'beverages',
          colors: [],
          brand: null,
          cost_price_tnd: 1000,
          sale_price_tnd: sale,
          notes: null,
          barcode_ean: ean,
          min_stock_threshold: null,
          search_blob: name.toLowerCase(),
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        },
        variant: {
          id: id + '-v',
          article_id: id,
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        },
        movement: {
          id: id + '-m',
          variant_id: id + '-v',
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
          created_at: now,
          deleted_at: null,
        },
      });
      const A = seed('art-a', 'GR-0001', 'Coca-Cola 33cl', a, 1500);
      const B = seed('art-b', 'GR-0002', 'Sidi Ali 1.5L', b, 1200);
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add(A.article);
        tx.objectStore('articles').add(B.article);
        tx.objectStore('variants').add(A.variant);
        tx.objectStore('variants').add(B.variant);
        tx.objectStore('movements').add(A.movement);
        tx.objectStore('movements').add(B.movement);
      });
      idb.close();
    },
    [eanA, eanB],
  );
  await page.reload();

  await page.goto('/sell');
  await expect(page.getByTestId('sell-screen')).toBeVisible();

  // Scan A twice + B once.
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), eanA);
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), eanA);
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), eanB);

  // Open cart drawer; both rows present.
  await page.getByTestId('sell-cart-toggle').click();
  await expect(page.getByTestId('sell-cart-sheet')).toBeVisible();
  const rowA = page.getByTestId('sell-cart-row-GR-0001');
  const rowB = page.getByTestId('sell-cart-row-GR-0002');
  await expect(rowA).toBeVisible();
  await expect(rowB).toBeVisible();
  // Coca-Cola at 1500 millimes × 2 = 3.000 TND; Sidi Ali at 1200 × 1 =
  // 1.200 TND. Total 4.200 TND.
  await expect(rowA).toContainText('×2');
  await expect(rowB).toContainText('×1');

  await page.getByTestId('sell-done').click();
  await expect(page).toHaveURL(/\/$/);

  // IDB read: alive sale movements should be exactly 2 with shared
  // transaction_id; deltas -2 and -1; locations 'floor'.
  const state = await page.evaluate(async () => {
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
    return movements;
  });
  type M = {
    type: string;
    delta: number;
    location: string | null;
    transaction_id: string | null;
    deleted_at: string | null;
    variant_id: string;
  };
  const sales = (state as M[]).filter((m) => m.type === 'sale' && m.deleted_at === null);
  expect(sales.length).toBe(2);
  // Both share a transaction_id.
  const txnIds = new Set(sales.map((m) => m.transaction_id));
  expect(txnIds.size).toBe(1);
  expect([...txnIds][0]).not.toBeNull();
  // Locations all 'floor'.
  for (const s of sales) expect(s.location).toBe('floor');
  // Delta sums per variant: -2 for art-a-v, -1 for art-b-v.
  const aSale = sales.find((s) => s.variant_id === 'art-a-v');
  const bSale = sales.find((s) => s.variant_id === 'art-b-v');
  expect(aSale?.delta).toBe(-2);
  expect(bSale?.delta).toBe(-1);
});
