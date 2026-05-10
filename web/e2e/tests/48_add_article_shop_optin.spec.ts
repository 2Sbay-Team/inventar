import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.5.1: per-article opt-in to sizes / colours for the shop vertical.
// Shop defaults to sizeless + colourless (right call for groceries +
// kiosk stock), but the merchant may also sell items like towels or
// stationery that have multiple sizes / colours. Two toggles in
// Step 2 enable just THIS article's variant UI without changing the
// vertical default.

test.describe('Add Article — shop sizes/colours opt-in', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Mini Mart',
      storeType: 'shop',
      shopSubtypes: ['household_cleaning'],
    });
    await page.reload();
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
  });

  test('opt-in section visible for shop; toggles flip aria-pressed', async ({ page }) => {
    await page.getByTestId('field-name').fill('Bath towel');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();

    const section = page.getByTestId('shop-variant-optin');
    await expect(section).toBeVisible();
    // Both toggles default OFF — shop's no-variant default is preserved
    // for the merchant who's adding ordinary groceries.
    await expect(page.getByTestId('shop-optin-sizes')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('shop-optin-colors')).toHaveAttribute('aria-pressed', 'false');

    // Flip both — now this article gets the sized + coloured variant
    // blocks normally reserved for shoes / clothes.
    await page.getByTestId('shop-optin-sizes').click();
    await page.getByTestId('shop-optin-colors').click();
    await expect(page.getByTestId('shop-optin-sizes')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('shop-optin-colors')).toHaveAttribute('aria-pressed', 'true');

    // The colour-chip strip appears in the first block once colours
    // are enabled; size rows appear once sizes are enabled.
    await expect(page.getByTestId('block-0-color-chips')).toBeVisible();
  });

  test('section hidden for non-shop verticals (shoes default has its own variants)', async ({
    page,
  }) => {
    // The beforeEach onboarded as shop; for this test we restart
    // with a shoes profile so the opt-in is irrelevant.
    await page.goto('/');
    await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      dbReq.result.close();
      await new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase('inventar');
        del.onsuccess = () => resolve();
        del.onerror = () => resolve();
      });
    });
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Shoes',
      storeType: 'shoes',
    });
    await page.reload();
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Trainer');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();
    await expect(page.getByTestId('shop-variant-optin')).toHaveCount(0);
  });

  test('saving with sizes opted in creates an article with multiple sized variants', async ({
    page,
  }) => {
    await page.getByTestId('field-name').fill('Bath towel');
    await page.getByTestId('field-cost').fill('5000');
    await page.getByTestId('field-sale').fill('8000');
    await page.getByTestId('continue').click();

    await page.getByTestId('shop-optin-sizes').click();

    // Photo is required for save. Test 05 confirms the err-photo
    // gating; we satisfy it the same way.
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });

    // Add a second size row and fill stock for both. Steppers expose
    // their value input under the bare testId; the size label uses
    // -input.
    await page.getByTestId('block-0-add-size').click();
    await page.getByTestId('block-0-size-0-input').fill('S');
    await page.getByTestId('block-0-size-0-floor').fill('3');
    await page.getByTestId('block-0-size-1-input').fill('L');
    await page.getByTestId('block-0-size-1-floor').fill('2');

    await page.getByTestId('save').click();
    // Save returns to Search; the new article shows up in results.
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // IDB check: this article must have >1 variant, each with a non-null
    // size. That's the proof the shop opt-in flowed through to the data.
    const variantSummary = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const variants = await new Promise<Array<{ size: string | null; color: string | null }>>(
        (resolve, reject) => {
          const tx = idb.transaction('variants', 'readonly');
          const r = tx.objectStore('variants').getAll();
          r.onsuccess = () =>
            resolve(
              (r.result as Array<{ size: string | null; color: string | null }>).map((v) => ({
                size: v.size,
                color: v.color,
              })),
            );
          r.onerror = () => reject(r.error);
        },
      );
      idb.close();
      return variants;
    });
    expect(variantSummary.length).toBe(2);
    expect(variantSummary.map((v) => v.size).sort()).toEqual(['L', 'S']);
    // Colour stays null because the colour toggle was not flipped —
    // a sized-only towel is a real shape (one colour, several sizes).
    expect(variantSummary.every((v) => v.color === null)).toBe(true);
  });
});
