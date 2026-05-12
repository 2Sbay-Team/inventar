import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// SPEC §3 / DATA_MODEL §8: export → reset → import round-trips losslessly.
// The third high-priority Playwright test specified in the plan.

test.describe('Backup export → reset → import round-trip', () => {
  test('round-trips an article + sale through the JSON file', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'RoundTrip' });
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'RoundTrip',
        locale: 'fr',
        reset: false,
        articles: [
          {
            name: 'Round shoe',
            colors: ['white'],
            sizes: [
              { size: '39', qty: 2 },
              { size: '40', qty: 2 },
              { size: '41', qty: 2 },
            ],
            cost_tnd: 40_000,
            sale_tnd: 75_000,
          },
        ],
      });
      await window.__inventarSeed!.sellOne('Round shoe', '40');
    });
    await page.reload();

    // Export the data — Playwright captures the download stream.
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('backup-export').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Reset everything.
    await page.getByTestId('reset').click();
    await page.getByTestId('reset-input').fill('CONFIRM');
    await page.getByTestId('reset-confirm').click();
    await expect(page.getByTestId('onboarding')).toBeVisible({ timeout: 5_000 });

    // Re-onboard quickly so the Settings screen is reachable.
    await onboardViaSeed(page, { lang: 'fr', shopName: 'RoundTrip2' });
    await page.reload();

    // Import the file back — replace mode.
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('backup-import').click();
    await page.setInputFiles('[data-testid="import-input"]', downloadPath!);
    await expect(page.getByTestId('import-prompt')).toBeVisible();
    await page.getByTestId('import-replace').click();
    await expect(page.getByTestId('import-prompt')).toBeHidden();

    // Verify the article + post-sale quantities survived.
    await page.getByTestId('nav-products').click();
    await page.getByTestId('search-input').fill('Round shoe');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    await page.getByTestId('result-card').first().click();
    await expect(page.getByTestId('size-39-qty')).toHaveText('2');
    await expect(page.getByTestId('size-40-qty')).toHaveText('1'); // post-sale
    await expect(page.getByTestId('size-41-qty')).toHaveText('2');

    // Also verify the integrity in IndexedDB matches expectations.
    const counts = await page.evaluate(async () => {
      return new Promise<{ articles: number; movements: number; expenses: number }>(
        (resolve, reject) => {
          const req = indexedDB.open('inventar');
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const database = req.result;
            const tx = database.transaction(['articles', 'movements', 'expenses'], 'readonly');
            let articles = 0,
              movements = 0,
              expenses = 0;
            tx.objectStore('articles').count().onsuccess = (e) => {
              articles = (e.target as IDBRequest<number>).result;
            };
            tx.objectStore('movements').count().onsuccess = (e) => {
              movements = (e.target as IDBRequest<number>).result;
            };
            tx.objectStore('expenses').count().onsuccess = (e) => {
              expenses = (e.target as IDBRequest<number>).result;
            };
            tx.oncomplete = () => {
              resolve({ articles, movements, expenses });
              database.close();
            };
          };
        },
      );
    });
    expect(counts.articles).toBe(1);
    // 3 initial purchases + 1 sale = 4 movements
    expect(counts.movements).toBe(4);
  });

  test('rejects a tampered backup', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Tamper Test' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    // Wait for the lazy-loaded settings chunk to actually mount before we
    // poke at its DOM via document.querySelector below — otherwise webkit
    // (which is slower at chunk parse) reads a tree without import-input.
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    // Build a malformed JSON in the page and feed it back through the
    // import path via setInputFiles + a synthetic File API call.
    const bad = JSON.stringify({ format: 'inventar-export-v1' });
    await page.evaluate(async (json) => {
      const input = document.querySelector('[data-testid="import-input"]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File([json], 'bad.json', { type: 'application/json' }));
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, bad);
    await expect(page.getByTestId('import-prompt')).toBeVisible();
    await page.getByTestId('import-replace').click();
    await expect(page.getByTestId('import-error')).toBeVisible();
  });
});
