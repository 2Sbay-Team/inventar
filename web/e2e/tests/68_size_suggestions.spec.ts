import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Size suggestion chips on Add Article: tappable rail above each
// colour block, narrowed by (sub-type × unit × category × standard).
// Free text is always accepted in addition.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

async function getSizeChipLabels(page: Page): Promise<string[]> {
  return page
    .getByTestId('block-0-size-chips')
    .locator('button')
    .evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? ''));
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

test.describe('Add Article — size suggestion chips', () => {
  test('Fashion + shoes-only → chips show EU 36-46', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['shoes'] });
    const chips = await getSizeChipLabels(page);
    expect(chips).toEqual(expect.arrayContaining(['36', '38', '40', '42', '44', '46']));
    expect(chips).not.toContain('S');
    expect(chips).not.toContain('XXXL');
  });

  test('Fashion + clothing_men only → chips show letter sizes S-XXXL', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['clothing_men'] });
    const chips = await getSizeChipLabels(page);
    expect(chips).toEqual(expect.arrayContaining(['S', 'M', 'L', 'XL', 'XXL', 'XXXL']));
    expect(chips).not.toContain('36');
    expect(chips).not.toContain('46');
  });

  test('Fashion: free text size "Petit" persists alongside the chips', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['clothing_men'] });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('Petit');
    await page.getByTestId('block-0-size-0-floor').fill('3');
    await page.getByTestId('save').click();
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

  test('Tap a chip → fills the size input', async ({ page }) => {
    await walkToStep2Fashion(page, { fashionSubtypes: ['shoes'] });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-chip-40').click();
    await expect(page.getByTestId('block-0-size-0-input')).toHaveValue('40');
  });
});
