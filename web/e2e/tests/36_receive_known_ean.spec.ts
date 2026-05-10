import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5 ADR-018 + ADR-019: /receive resolves a scanned EAN against the
// catalogue. Match → bottom sheet shows the existing article (name,
// internal_code, current stock) + qty stepper + optional expiry. Save
// appends one purchase Movement (location='back', transaction_id=
// session, expires_at) and, when expiry is set, one Lot row pointing
// back to that movement via source_movement_id.

test('receive: scanning a known EAN opens the existing-article sheet, save records purchase + lot', async ({
  page,
}) => {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Receive Known',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });

  // Seed a shop article with a known barcode + 10 units already in
  // stock. We do this through the public IDB API rather than the UI so
  // the test stays focused on the receive flow.
  const ean = '5449000000996';
  await page.evaluate(async (eanValue) => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const idb = dbReq.result;
    const now = new Date().toISOString();
    const articleId = 'coca-test';
    const variantId = 'coca-variant';
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore('articles').add({
        id: articleId,
        internal_code: 'GR-0001',
        name: 'Coca-Cola 33cl',
        photo_id: null,
        category: 'beverages',
        colors: [],
        brand: 'Coca-Cola',
        cost_price_tnd: 1000,
        sale_price_tnd: 1500,
        notes: null,
        barcode_ean: eanValue,
        min_stock_threshold: null,
        search_blob: 'coca-cola 33cl coca-cola beverages gr-0001',
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: variantId,
        article_id: articleId,
        color: null,
        size: null,
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'coca-seed',
        variant_id: variantId,
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
      });
    });
    idb.close();
  }, ean);
  await page.reload();

  // Land on /receive — for shop merchants the bottom nav surfaces it
  // in place of Add. The route also accepts direct navigation.
  await page.goto('/receive');
  await expect(page.getByTestId('receive-screen')).toBeVisible();
  await expect(page.getByTestId('receive-counter')).toContainText('0');

  // Inject a scan that matches the seeded EAN. The known-article sheet
  // should open with the right copy.
  await page.evaluate((v) => window.__inventarSeed!.simulateScan(v), ean);
  const sheet = page.getByTestId('receive-known-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Coca-Cola 33cl');
  await expect(sheet).toContainText('GR-0001');
  await expect(page.getByTestId('receive-known-stock')).toContainText('10');

  // Fill quantity 24 (stepper from default 1: tap +23 times).
  for (let i = 0; i < 23; i += 1) {
    await page.getByTestId('receive-known-qty-plus').click();
  }
  await expect(page.getByTestId('receive-known-qty')).toHaveValue('24');
  // Optional expiry.
  await page.getByTestId('receive-known-expiry').fill('2026-08-15');
  await page.getByTestId('receive-known-save').click();

  // Sheet closes; counter advances; we're back on the camera view
  // ready for the next scan.
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('receive-counter')).toContainText('1');

  // IDB assertions: one new purchase Movement (delta=24, expires_at,
  // transaction_id non-null) and one new Lot row (variant_id matches).
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
    const lots = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('lots', 'readonly');
      const r = tx.objectStore('lots').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return { movements, lots };
  });

  type M = {
    id: string;
    variant_id: string;
    delta: number;
    type: string;
    location: string | null;
    transaction_id: string | null;
    expires_at: string | null;
    deleted_at: string | null;
  };
  type L = {
    id: string;
    variant_id: string;
    expires_at: string;
    original_quantity: number;
    source_movement_id: string;
    deleted_at: string | null;
  };
  const movements = state.movements as M[];
  const lots = state.lots as L[];

  // The seed put one movement in (the +10). After receive, the second
  // movement is the +24 purchase from the receive flow.
  const aliveMovs = movements.filter((m) => m.deleted_at === null);
  expect(aliveMovs.length).toBe(2);
  const received = aliveMovs.find((m) => m.delta === 24);
  expect(received, 'expected a +24 purchase movement').toBeTruthy();
  expect(received!.type).toBe('purchase');
  expect(received!.location).toBe('back');
  expect(received!.expires_at).toContain('2026-08-15');
  expect(received!.transaction_id).not.toBeNull();
  expect(received!.variant_id).toBe('coca-variant');

  // Exactly one Lot was created — for the +24 movement, with the same
  // expires_at.
  const aliveLots = lots.filter((l) => l.deleted_at === null);
  expect(aliveLots.length).toBe(1);
  expect(aliveLots[0]!.variant_id).toBe('coca-variant');
  expect(aliveLots[0]!.original_quantity).toBe(24);
  expect(aliveLots[0]!.expires_at).toContain('2026-08-15');
  expect(aliveLots[0]!.source_movement_id).toBe(received!.id);
});
