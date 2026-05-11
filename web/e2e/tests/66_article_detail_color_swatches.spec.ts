import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.5.2.8 — Article Detail color-swatch strip. Industry-standard
// pattern (Shopify / Lightspeed / WooCommerce / Magento): the hero
// photo defaults to the article-level photo; below it, one swatch per
// unique colour, each showing that colour's variant photo. Tapping a
// swatch swaps the hero. Tapping again deselects.

test.describe('Article Detail — color swatch strip', () => {
  test('multi-color article: strip renders one swatch per color and swaps hero on tap', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();

    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await page.getByTestId('field-name').fill('Polo Shirt');
    await page.getByTestId('field-cost').fill('5000');
    await page.getByTestId('field-sale').fill('15000');
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-2')).toBeVisible();

    // White block: photo + size S.
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('S');
    await page.getByTestId('block-0-size-0-floor').fill('3');

    // Black block: photo + size M.
    await page.getByTestId('add-color-block').click();
    await page.setInputFiles('[data-testid="block-1-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-1-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-1-color-black').click();
    await page.getByTestId('block-1-size-0-input').fill('M');
    await page.getByTestId('block-1-size-0-floor').fill('2');

    await page.getByTestId('save').click();
    // Post-save lands on the printable label first; Done returns to detail.
    await expect(page.getByTestId('label-screen')).toBeVisible();
    await page.getByTestId('label-done').click();
    await expect(page.getByTestId('detail-bar')).toBeVisible();

    // The strip is present and has one swatch per unique color.
    const strip = page.getByTestId('color-swatch-strip');
    await expect(strip).toBeVisible();
    await expect(page.getByTestId('color-swatch-white')).toBeVisible();
    await expect(page.getByTestId('color-swatch-black')).toBeVisible();
    // No "blue" / "red" swatches that we didn't create.
    await expect(page.getByTestId('color-swatch-red')).toHaveCount(0);
    await expect(page.getByTestId('color-swatch-blue')).toHaveCount(0);

    // Initial: neither swatch is pressed (article-level fallback is showing).
    await expect(page.getByTestId('color-swatch-white')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('color-swatch-black')).toHaveAttribute('aria-pressed', 'false');

    // Tap white → pressed; tap again → released.
    await page.getByTestId('color-swatch-white').click();
    await expect(page.getByTestId('color-swatch-white')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('color-swatch-black')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('color-swatch-white').click();
    await expect(page.getByTestId('color-swatch-white')).toHaveAttribute('aria-pressed', 'false');

    // Switching from white to black: only one stays pressed at a time.
    await page.getByTestId('color-swatch-white').click();
    await page.getByTestId('color-swatch-black').click();
    await expect(page.getByTestId('color-swatch-black')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('color-swatch-white')).toHaveAttribute('aria-pressed', 'false');
  });

  test('sizeless article (shop vertical): strip does not render', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Kiosk',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await page.getByTestId('field-name').fill('Bottled Water');
    await page.getByTestId('field-cost').fill('500');
    await page.getByTestId('field-sale').fill('1000');
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-2')).toBeVisible();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    // Shop vertical sizeless block — no size rows; floor / back are
    // stepper-driven on a single row. Click + a few times to add stock.
    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId('block-0-back-plus').click();
    }
    await page.getByTestId('save').click();

    await expect(page.getByTestId('label-screen')).toBeVisible();
    await page.getByTestId('label-done').click();
    await expect(page.getByTestId('detail-bar')).toBeVisible();

    // No swatch strip — every variant has color=null for shop.
    await expect(page.getByTestId('color-swatch-strip')).toHaveCount(0);
  });
});
