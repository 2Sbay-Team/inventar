import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// v0.5.6 ADR-031 — size suggestion chips on Add Article are now
// sub-type AND category-aware for Fashion, and a fixed package-size
// list for Shop. The merchant can always type free text in addition
// to the suggestions.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

async function getDatalistOptions(page: Page, datalistTestId: string): Promise<string[]> {
  return page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!(el instanceof HTMLDataListElement)) return [];
    return Array.from(el.options).map((o) => o.value);
  }, datalistTestId);
}

async function walkToStep2Fashion(
  page: Page,
  options: { fashionSubtypes: string[]; category?: string },
): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Size Hints',
    storeType: 'fashion',
    fashionSubtypes: options.fashionSubtypes as never,
  });
  await page.reload();
  await page.goto('/add');
  await expect(page.getByTestId('step-1')).toBeVisible();
  await page.getByTestId('field-name').fill('Test item');
  // Default category is the first in the picker; override by tapping
  // a specific chip when the test cares.
  if (options.category) {
    await page.getByTestId(`category-${options.category}`).click();
  }
  await page.getByTestId('field-cost').fill('5000');
  await page.getByTestId('field-sale').fill('15000');
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-2')).toBeVisible();
  await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
  await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
}

test.describe('Add Article — size suggestions (v0.5.6 ADR-031)', () => {
  test('Fashion + shoes-only → datalist shows EU 36-46', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['shoes'] });
    const options = await getDatalistOptions(page, 'block-0-size-hints');
    expect(options).toEqual(expect.arrayContaining(['36', '38', '40', '42', '44', '46']));
    expect(options).not.toContain('S');
    expect(options).not.toContain('XXXL');
  });

  test('Fashion + clothing_men only → datalist shows letter sizes S-XXXL', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['clothing_men'] });
    const options = await getDatalistOptions(page, 'block-0-size-hints');
    expect(options).toEqual(expect.arrayContaining(['S', 'M', 'L', 'XL', 'XXL', 'XXXL']));
    expect(options).not.toContain('36');
    expect(options).not.toContain('46');
  });

  test('Fashion + shoes + clothing_men: category narrows the chip pool', async ({ page }) => {
    // A merchant who stocks shoes AND clothing_men, adding a SHIRT
    // (category='shirts' belongs only to clothing_men) should not see
    // EU shoe sizes in the chips.
    await walkToStep2Fashion(page, {
      fashionSubtypes: ['shoes', 'clothing_men'],
      category: 'shirts',
    });
    const options = await getDatalistOptions(page, 'block-0-size-hints');
    expect(options).toEqual(expect.arrayContaining(['S', 'M', 'XXXL']));
    expect(options).not.toContain('36');
  });

  test('Fashion + accessories only → datalist absent (size_hint=none)', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['accessories'] });
    // The hasSizes guard hides the size column entirely when the
    // article-traits resolve to has_sizes=false; if the merchant
    // never sees a size input, the datalist isn't rendered either.
    await expect(page.locator('[data-testid="block-0-size-hints"]')).toHaveCount(0);
  });

  test('Fashion: free text size "Petit" persists alongside the suggestions', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['clothing_men'] });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('Petit');
    await page.getByTestId('block-0-size-0-floor').fill('3');
    await page.getByTestId('save').click();
    // Save lands the merchant on the printable-label screen; from there
    // we hop to the article detail and confirm the variant carries
    // the custom-typed size.
    await expect(page.getByTestId('label-screen')).toBeVisible({ timeout: 10_000 });
    const stored = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        dbReq.onsuccess = () => resolve(dbReq.result);
        dbReq.onerror = () => reject(dbReq.error);
      });
      const variants = await new Promise<{ size: string }[]>((resolve, reject) => {
        const tx = idb.transaction('variants', 'readonly');
        const req = tx.objectStore('variants').getAll();
        req.onsuccess = () => resolve(req.result as { size: string }[]);
        req.onerror = () => reject(req.error);
      });
      return variants.map((v) => v.size);
    });
    expect(stored).toContain('Petit');
  });

  test('Shop vertical: package-size suggestions appear when the sizeless block opts into sizes', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Mini Mart',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await page.getByTestId('field-name').fill('Bottled water');
    await page.getByTestId('field-cost').fill('500');
    await page.getByTestId('field-sale').fill('1000');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();
    // Shop's sizeless block — opt into sizes.
    await page.getByTestId('shop-optin-sizes').click();
    const options = await getDatalistOptions(page, 'block-0-size-hints');
    expect(options).toEqual(['250ml', '500ml', '1L', '500g', '1Kg', '5Kg']);
  });
});
