import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-018: when a scanned EAN does not match any catalogue article,
// /receive opens a mini-form that creates the Article + the initial
// purchase Movement in one go. The new article carries
// barcode_ean = the scanned value so the next scan resolves to the
// known-article path.

test('receive: scanning an unknown EAN opens the mini-form, save creates Article + purchase movement', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Receive Unknown',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  await page.goto('/receive');
  await expect(page.getByTestId('receive-screen')).toBeVisible();

  const newEan = '1234567890123';
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), newEan);

  const sheet = page.getByTestId('receive-unknown-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('receive-unknown-ean')).toContainText(newEan);

  // Fill the mini-form: name + cost + sale + qty. Category defaults to
  // the first sub-type-derived chip (food_beverages → 'produce').
  await page.getByTestId('receive-unknown-name').fill('Test Product');
  await page.getByTestId('receive-unknown-cost').fill('5');
  await page.getByTestId('receive-unknown-sale').fill('7');
  for (let i = 0; i < 11; i += 1) {
    await page.getByTestId('receive-unknown-qty-plus').click();
  }
  await expect(page.getByTestId('receive-unknown-qty')).toHaveValue('12');

  await page.getByTestId('receive-unknown-save').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('receive-counter')).toContainText('1');

  // IDB assertions: one Article (barcode_ean=value, internal_code
  // GR-NNNN), one purchase Movement (delta=12, transaction_id non-null,
  // expires_at null since we omitted it), no Lot.
  const state = await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const idb = dbReq.result;
    const articles = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('articles', 'readonly');
      const r = tx.objectStore('articles').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    const movements = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('movements', 'readonly');
      const r = tx.objectStore('movements').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    const lots = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('lots', 'readonly');
      const r = tx.objectStore('lots').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return { articles, movements, lots };
  });

  type A = {
    name: string;
    internal_code: string;
    barcode_ean: string | null;
    deleted_at: string | null;
  };
  type M = {
    delta: number;
    type: string;
    transaction_id: string | null;
    expires_at: string | null;
    deleted_at: string | null;
  };

  const articles = (state.articles as A[]).filter((a) => a.deleted_at === null);
  expect(articles.length).toBe(1);
  expect(articles[0]!.name).toBe('Test Product');
  expect(articles[0]!.barcode_ean).toBe(newEan);
  // v0.5.2 ADR-021: shop sku_prefix changed from GR → SP.
  expect(articles[0]!.internal_code).toMatch(/^SP-\d{4}$/);

  const movements = (state.movements as M[]).filter((m) => m.deleted_at === null);
  expect(movements.length).toBe(1);
  expect(movements[0]!.type).toBe('purchase');
  expect(movements[0]!.delta).toBe(12);
  expect(movements[0]!.transaction_id).not.toBeNull();
  expect(movements[0]!.expires_at).toBeNull();

  // No expiry → no Lot.
  expect(state.lots).toEqual([]);
});

test('receive: scanning the same EAN AFTER creating the article routes to the known-article sheet', async ({
  page,
}) => {
  // This case exercises the full round-trip: a previously-unknown EAN
  // is now resolved against the catalogue on the next scan. Catches the
  // failure mode where barcode_ean gets stored as a different shape
  // than the lookup expects.
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Receive RoundTrip',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  await page.goto('/receive');
  // Wait for the receive screen to mount before dispatching the e2e
  // scan — the screen's CustomEvent listener is wired in useEffect, so
  // a too-eager simulateScan misses it and the sheet never opens.
  await expect(page.getByTestId('receive-screen')).toBeVisible();
  const ean = '7622210449283';
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), ean);
  await expect(page.getByTestId('receive-unknown-sheet')).toBeVisible();
  await page.getByTestId('receive-unknown-name').fill('Round Trip');
  await page.getByTestId('receive-unknown-cost').fill('2');
  await page.getByTestId('receive-unknown-sale').fill('3');
  await page.getByTestId('receive-unknown-save').click();
  await expect(page.getByTestId('receive-unknown-sheet')).toHaveCount(0);

  // Scan again — should now hit the known-article path. The listener is
  // already mounted (we never left /receive), so no extra wait needed.
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), ean);
  const knownSheet = page.getByTestId('receive-known-sheet');
  await expect(knownSheet).toBeVisible();
  await expect(knownSheet).toContainText('Round Trip');
});
