import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.5.1: clothes vertical smoke. The clothes config in
// src/config/store-types.ts inherits the same has_sizes=true +
// has_colors=true + primary_flow='add' shape as shoes, so the
// existing shoes-focused suite (tests 5, 30, 31) covers most of the
// data path indirectly. This test exercises clothes specifically end-
// to-end so a regression that ONLY breaks clothes (e.g. a stray
// `storeType === 'shoes'` check leaking into shared logic) trips a
// dedicated assertion instead of hiding behind shoes coverage.

test.describe('Clothes vertical — end-to-end smoke', () => {
  test('onboard → add sized + coloured shirt → search finds it → IDB shows N variants', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique',
      storeType: 'clothes',
    });
    await page.reload();

    // Add Article. Clothes uses the same Step 2 variant block UI as
    // shoes — colour chips + size rows in a single per-colour block.
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    // Internal-code SKU prefix should be 'CL' for clothes.
    await expect(page.getByTestId('field-code')).toContainText('CL-');
    await page.getByTestId('field-name').fill('Cotton T-shirt');
    await page.getByTestId('field-cost').fill('10000');
    await page.getByTestId('field-sale').fill('25000');
    await page.getByTestId('category-shirts').click();
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-2')).toBeVisible();
    // shop-variant-optin must NOT render for clothes — clothes already
    // has sizes + colours by vertical default.
    await expect(page.getByTestId('shop-variant-optin')).toHaveCount(0);

    // First block: white, two sizes (S=4, M=2).
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('S');
    await page.getByTestId('block-0-size-0-floor').fill('4');
    await page.getByTestId('block-0-add-size').click();
    await page.getByTestId('block-0-size-1-input').fill('M');
    await page.getByTestId('block-0-size-1-floor').fill('2');

    // Second colour block: black, one size (M=3).
    await page.getByTestId('add-color-block').click();
    await page.setInputFiles('[data-testid="block-1-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-1-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-1-color-black').click();
    await page.getByTestId('block-1-size-0-input').fill('M');
    await page.getByTestId('block-1-size-0-floor').fill('3');

    await page.getByTestId('save').click();
    // v0.5.2.3 — post-save lands on the printable label first.
    await expect(page.getByTestId('label-screen')).toBeVisible();
    // Article Detail (where Done lands) hides the nav, so go to Search by URL.
    await page.getByTestId('label-done').click();
    await page.goto('/');
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('search-input').fill('Cotton');
    await expect(page.getByTestId('result-card')).toHaveCount(1);

    // IDB check: 1 article, 3 variants (white-S, white-M, black-M),
    // 3 purchase movements (initial stock per variant).
    const summary = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      function readAll<T>(store: string): Promise<T[]> {
        return new Promise<T[]>((resolve, reject) => {
          const tx = idb.transaction(store, 'readonly');
          const r = tx.objectStore(store).getAll();
          r.onsuccess = () => resolve(r.result as T[]);
          r.onerror = () => reject(r.error);
        });
      }
      const articles = await readAll<{ name: string; deleted_at: string | null }>('articles');
      const variants = await readAll<{
        color: string | null;
        size: string | null;
        deleted_at: string | null;
      }>('variants');
      const movements = await readAll<{
        type: string;
        delta: number;
        deleted_at: string | null;
      }>('movements');
      idb.close();
      return {
        alive_articles: articles.filter((a) => a.deleted_at === null),
        alive_variants: variants
          .filter((v) => v.deleted_at === null)
          .map((v) => `${v.color ?? '?'}-${v.size ?? '?'}`)
          .sort(),
        alive_purchases: movements.filter((m) => m.deleted_at === null && m.type === 'purchase'),
      };
    });

    expect(summary.alive_articles.length).toBe(1);
    expect(summary.alive_articles[0]?.name).toBe('Cotton T-shirt');
    expect(summary.alive_variants).toEqual(['black-M', 'white-M', 'white-S']);
    expect(summary.alive_purchases.length).toBe(3);
    const totalUnits = summary.alive_purchases.reduce((acc, m) => acc + m.delta, 0);
    expect(totalUnits).toBe(9); // 4 + 2 + 3
  });

  test('clothes nav surfaces "Add" as the primary tab (not "Receive")', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique Two',
      storeType: 'clothes',
    });
    await page.reload();
    // Clothes is primary_flow='add', so nav-add is rendered (the same
    // way shoes works). Shop is the only vertical that swaps it for
    // nav-receive — proving here that clothes follows the add-first
    // contract.
    await expect(page.getByTestId('nav-add')).toBeVisible();
    await expect(page.getByTestId('nav-receive')).toHaveCount(0);
  });
});
