import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.3 (ADR-011): Add Article is a two-step flow.
//   Step 1 — basics: name, brand, category, prices, notes.
//   Step 2 — variants: per-colour blocks (shoes/clothes) with photo,
//            colour picker, optional manufacturer code, and size rows
//            with floor + back stock; a single floor + back input for
//            sizeless verticals.

test.describe('Add Article — two-step flow, fields, validation, save', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Add Test' });
    await page.reload();
    await page.getByTestId('nav-add').click();
    await expect(page.getByTestId('step-1')).toBeVisible();
  });

  test('continue is disabled until name is at least 2 chars', async ({ page }) => {
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('field-name').fill('A');
    await expect(page.getByTestId('continue')).toBeDisabled();
    await page.getByTestId('field-name').fill('Sample shoe');
    await expect(page.getByTestId('continue')).toBeEnabled();
  });

  test('step 1 fields are present and writable; step 2 reveals per-colour blocks', async ({
    page,
  }) => {
    await expect(page.getByTestId('field-code')).toContainText('SH-');
    await page.getByTestId('field-name').fill('Test name');
    await page.getByTestId('field-brand').fill('Lotto');
    await page.getByTestId('category-sport').click();
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('field-notes').fill('A note');
    await page.getByTestId('continue').click();

    await expect(page.getByTestId('step-2')).toBeVisible();
    await expect(page.getByTestId('block-0')).toBeVisible();
    await expect(page.getByTestId('block-0-color-chips')).toBeVisible();
    await expect(page.getByTestId('block-0-size-0-input')).toBeVisible();
    await expect(page.getByTestId('add-color-block')).toBeVisible();
  });

  test('save persists the article and lands on Search', async ({ page }) => {
    await page.getByTestId('field-name').fill('Workflow shoe');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('continue').click();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('40');
    await page.getByTestId('block-0-size-0-back-plus').click();
    await page.getByTestId('save').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('search-input').fill('Workflow');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
  });

  test('cancel from step 1 returns to previous screen', async ({ page }) => {
    await page.getByTestId('add-cancel').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('back button on step 2 returns to step 1', async ({ page }) => {
    await page.getByTestId('field-name').fill('Backflow');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();
    await page.getByTestId('add-back').click();
    await expect(page.getByTestId('step-1')).toBeVisible();
    // Field state is preserved across step transitions so the user
    // doesn't lose typed input.
    await expect(page.getByTestId('field-name')).toHaveValue('Backflow');
  });

  test('save without photo or stock surfaces inline errors', async ({ page }) => {
    await page.getByTestId('field-name').fill('Validate');
    await page.getByTestId('continue').click();
    // No photo, no stock — both errors should render.
    await page.getByTestId('save').click();
    await expect(page.getByTestId('err-photo')).toBeVisible();
    await expect(page.getByTestId('err-stock')).toBeVisible();
  });
});
