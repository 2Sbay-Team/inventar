import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

test.describe('Add Article — fields, validation, save', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Add Test' });
    await page.reload();
    await page.getByTestId('nav-add').click();
  });

  test('save buttons are disabled until photo + name are present', async ({ page }) => {
    await expect(page.getByTestId('save')).toBeDisabled();
    await expect(page.getByTestId('save-and-add')).toBeDisabled();
    await page.setInputFiles('[data-testid="photo-input"]', SAMPLE);
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('save')).toBeDisabled(); // still no name
    await page.getByTestId('field-name').fill('A'); // 1 char — too short
    await expect(page.getByTestId('save')).toBeDisabled();
    await page.getByTestId('field-name').fill('Sample shoe');
    await expect(page.getByTestId('save')).toBeEnabled();
  });

  test('all 7 form fields are present and writable', async ({ page }) => {
    await page.setInputFiles('[data-testid="photo-input"]', SAMPLE);
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('field-code')).toContainText('SH-');
    await page.getByTestId('field-name').fill('Test name');
    await page.getByTestId('color-white').click();
    await page.getByTestId('field-brand').fill('Lotto');
    await page.getByTestId('category-sport').click();
    await page.getByTestId('field-sizes').fill('39, 40, 41');
    await page.getByTestId('qty-plus').click();
    await expect(page.getByTestId('qty-value')).toHaveText('2');
    await page.getByTestId('qty-minus').click();
    await expect(page.getByTestId('qty-value')).toHaveText('1');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await expect(page.getByTestId('save')).toBeEnabled();
  });

  test('save persists the article and lands on Search', async ({ page }) => {
    await page.setInputFiles('[data-testid="photo-input"]', SAMPLE);
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('field-name').fill('Workflow shoe');
    await page.getByTestId('field-sizes').fill('40');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('search-input').fill('Workflow');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
  });

  test('save-and-add resets photo + name but keeps colour/category', async ({ page }) => {
    await page.setInputFiles('[data-testid="photo-input"]', SAMPLE);
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('field-name').fill('First');
    await page.getByTestId('color-blue').click();
    await page.getByTestId('category-women').click();
    await page.getByTestId('field-sizes').fill('40');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('save-and-add').click();
    // After save-and-add we stay on the form, photo cleared, name cleared.
    await expect(page.getByTestId('photo-preview')).toBeHidden();
    await expect(page.getByTestId('field-name')).toHaveValue('');
    await expect(page.getByTestId('color-blue')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('category-women')).toHaveAttribute('aria-pressed', 'true');
  });

  test('cancel returns to previous screen', async ({ page }) => {
    await page.getByTestId('add-cancel').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('validation errors surface for invalid sizes', async ({ page }) => {
    await page.setInputFiles('[data-testid="photo-input"]', SAMPLE);
    await expect(page.getByTestId('photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('field-name').fill('Validate');
    await page.getByTestId('field-sizes').fill('!!!');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('err-sizes')).toBeVisible();
  });
});
