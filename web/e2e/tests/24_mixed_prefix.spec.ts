import { expect, test } from '@playwright/test';
import { onboardViaUI } from '../helpers/onboarding';

// Verifies the per-store-type SKU prefix logic across a store-type
// switch. A shop that started on shoes (SH-XXXX articles) and switched
// to clothes should get its NEXT article numbered CL-N+1 — the parser
// reads the global numeric max regardless of which prefix it carries.

test('mixed prefix: switching shoes → clothes continues from global max', async ({ page }) => {
  await page.goto('/');
  await onboardViaUI(page, { lang: 'en', shopName: 'Mix Test' });
  await expect(page.getByTestId('search-screen')).toBeVisible();

  // Seed 3 shoe articles directly so we don't depend on the photo-
  // required Add Article UI in this assertion path.
  await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((res, rej) => {
      dbReq.onsuccess = () => res();
      dbReq.onerror = () => rej(dbReq.error);
    });
    const db = dbReq.result;
    const now = new Date().toISOString();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('articles', 'readwrite');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      const store = tx.objectStore('articles');
      for (const code of ['SH-0001', 'SH-0002', 'SH-0003']) {
        store.add({
          id: `id-${code}`,
          internal_code: code,
          name: `Shoe ${code}`,
          photo_id: null,
          category: 'sport',
          colors: [],
          brand: null,
          cost_price_tnd: 0,
          sale_price_tnd: 0,
          notes: null,
          search_blob: code.toLowerCase(),
          updated_at: now,
          archived_at: null,
          deleted_at: null,
        });
      }
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible();

  // Switch the store type to clothes via Settings.
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-store-type').selectOption('clothes');
  await page.getByTestId('store-type-confirm-btn').click();
  await expect(page.getByTestId('store-type-confirm')).toHaveCount(0);

  // Open Add Article — the previewed code should be CL-0004 (next from
  // global max SH-0003), not CL-0001.
  await page.getByTestId('nav-add').click();
  // The previewed-code badge isn't given a specific testid in the
  // current add-article markup, so we look for the literal "CL-0004"
  // anywhere on the screen.
  await expect(page.locator('text=CL-0004')).toBeVisible({ timeout: 4000 });
});
