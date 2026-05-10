import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-020 — Quick Adjust manual lot override. When a shop
// variant has ≥2 alive lots with remaining > 0, a Lot dropdown
// appears in the Quick Adjust sheet for sale / return reasons.
// Default selection is FIFO (earliest expiry); merchant can override.

test.describe('Quick Adjust — manual lot override', () => {
  test('shop variant with 2 lots: dropdown appears, FIFO is default, override sets lot_id', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Lot Override',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    // Seed an article + variant + 2 lots (different expiries) + the
    // purchase movements that created them.
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements', 'lots'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: 'a1',
          internal_code: 'SP-0001',
          name: 'Yogurt',
          photo_id: null,
          category: 'dairy',
          colors: [],
          brand: null,
          cost_price_tnd: 1000,
          sale_price_tnd: 2000,
          notes: null,
          barcode_ean: null,
          min_stock_threshold: null,
          expiry_alert_days: null,
          search_blob: 'yogurt',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'v1',
          article_id: 'a1',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        });
        // Lot A: earlier expiry (FIFO default).
        tx.objectStore('lots').add({
          id: 'lot-a',
          variant_id: 'v1',
          expires_at: '2026-06-15T00:00:00.000Z',
          received_at: now,
          original_quantity: 5,
          source_movement_id: 'mv-a',
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'mv-a',
          variant_id: 'v1',
          delta: 5,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: '2026-06-15T00:00:00.000Z',
          lot_id: 'lot-a',
          refunds_movement_id: null,
          created_at: now,
          deleted_at: null,
        });
        // Lot B: later expiry.
        tx.objectStore('lots').add({
          id: 'lot-b',
          variant_id: 'v1',
          expires_at: '2026-08-20T00:00:00.000Z',
          received_at: now,
          original_quantity: 8,
          source_movement_id: 'mv-b',
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'mv-b',
          variant_id: 'v1',
          delta: 8,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: '2026-08-20T00:00:00.000Z',
          lot_id: 'lot-b',
          refunds_movement_id: null,
          created_at: now,
          deleted_at: null,
        });
      });
      idb.close();
    });

    // Open Article Detail and tap Sell to open Quick Adjust.
    await page.goto('/article/a1');
    await page.getByTestId('action-sell').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeVisible();

    // Lot dropdown is visible (2 alive lots + reason=sale by default).
    const dropdown = page.getByTestId('adjust-lot');
    await expect(dropdown).toBeVisible();
    // Default = lot-a (earliest expiry).
    await expect(dropdown).toHaveValue('lot-a');

    // Switch to lot-b and confirm.
    await dropdown.selectOption('lot-b');
    await expect(dropdown).toHaveValue('lot-b');

    // Confirm — write the sale movement with lot_id=lot-b.
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toHaveCount(0);

    const saleLot = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve) => {
        dbReq.onsuccess = () => resolve();
      });
      const idb = dbReq.result;
      const movements = await new Promise<Array<{ type: string; lot_id: string | null }>>(
        (resolve) => {
          const tx = idb.transaction('movements', 'readonly');
          const r = tx.objectStore('movements').getAll();
          r.onsuccess = () => resolve(r.result as Array<{ type: string; lot_id: string | null }>);
        },
      );
      idb.close();
      return movements.find((m) => m.type === 'sale')?.lot_id ?? '?';
    });
    expect(saleLot).toBe('lot-b');
  });

  test('shop variant with 1 lot: dropdown is HIDDEN', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Single Lot',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve) => {
        dbReq.onsuccess = () => resolve();
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements', 'lots'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.objectStore('articles').add({
          id: 'a2',
          internal_code: 'SP-0002',
          name: 'Bread',
          photo_id: null,
          category: 'bakery',
          colors: [],
          brand: null,
          cost_price_tnd: 500,
          sale_price_tnd: 800,
          notes: null,
          barcode_ean: null,
          min_stock_threshold: null,
          expiry_alert_days: null,
          search_blob: 'bread',
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
        tx.objectStore('variants').add({
          id: 'v2',
          article_id: 'a2',
          color: null,
          size: null,
          photo_id: null,
          hidden: false,
          updated_at: now,
          deleted_at: null,
        });
        tx.objectStore('lots').add({
          id: 'lot-c',
          variant_id: 'v2',
          expires_at: '2026-06-15T00:00:00.000Z',
          received_at: now,
          original_quantity: 3,
          source_movement_id: 'mv-c',
          deleted_at: null,
        });
        tx.objectStore('movements').add({
          id: 'mv-c',
          variant_id: 'v2',
          delta: 3,
          type: 'purchase',
          note: null,
          unit_price_tnd: null,
          location: 'back',
          transfer_from: null,
          transfer_to: null,
          transaction_id: null,
          expires_at: '2026-06-15T00:00:00.000Z',
          lot_id: 'lot-c',
          refunds_movement_id: null,
          created_at: now,
          deleted_at: null,
        });
      });
      idb.close();
    });

    await page.goto('/article/a2');
    await page.getByTestId('action-sell').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeVisible();
    // Single alive lot — dropdown does NOT appear.
    await expect(page.getByTestId('adjust-lot')).toHaveCount(0);
  });
});
