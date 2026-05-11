import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.6 — exercises the Add Article Unit dropdown after the v0.5.6
// polish: renamed label ("Sold by" → "Unit"), nine options including
// the four new countable / length units, and the locale-aware default
// (Pair for a shoes-only fashion merchant; Piece otherwise).

const ALL_UNIT_VALUES = ['piece', 'pair', 'pack', 'dozen', 'kg', 'g', 'l', 'ml', 'meter'] as const;

async function openAddArticle(
  page: Page,
  options: {
    storeType: 'fashion' | 'shop';
    fashionSubtypes?: string[];
    shopSubtypes?: string[];
  },
): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'UoM Shop',
    storeType: options.storeType,
    fashionSubtypes: options.fashionSubtypes as never,
    shopSubtypes: options.shopSubtypes as never,
  });
  await page.reload();
  await page.goto('/add');
  await expect(page.getByTestId('step-1')).toBeVisible();
}

test.describe('Add Article — Unit dropdown (v0.5.6)', () => {
  test('renders nine option values in the correct order', async ({ page }) => {
    await openAddArticle(page, {
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    const select = page.getByTestId('field-uom');
    await expect(select).toBeVisible();
    const optionValues = await select.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    expect(optionValues).toEqual([...ALL_UNIT_VALUES]);
  });

  test('default is Piece for a fashion+clothing_men merchant', async ({ page }) => {
    await openAddArticle(page, {
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await expect(page.getByTestId('field-uom')).toHaveValue('piece');
  });

  test('default is Pair for a fashion+shoes-only merchant', async ({ page }) => {
    await openAddArticle(page, {
      storeType: 'fashion',
      fashionSubtypes: ['shoes'],
    });
    // The effect that promotes piece→pair runs after the profile
    // resolves; wait briefly for it to settle.
    await expect(page.getByTestId('field-uom')).toHaveValue('pair', { timeout: 5_000 });
  });

  test('default is Pair for fashion+shoes+shoes_kids (both shoes sub-types)', async ({ page }) => {
    await openAddArticle(page, {
      storeType: 'fashion',
      fashionSubtypes: ['shoes', 'shoes_kids'],
    });
    await expect(page.getByTestId('field-uom')).toHaveValue('pair', { timeout: 5_000 });
  });

  test('default stays Piece for a fashion merchant with mixed shoes + clothing sub-types', async ({
    page,
  }) => {
    // Mixed sub-types default to Piece per the v0.5.6 brief — a
    // merchant adding a shirt should not see "Pair" silently.
    await openAddArticle(page, {
      storeType: 'fashion',
      fashionSubtypes: ['shoes', 'clothing_men'],
    });
    // Same expected outcome as fashion+clothing_men — the effect
    // never promotes to Pair because the gate requires every sub-
    // type to be in the shoes-related set.
    await expect(page.getByTestId('field-uom')).toHaveValue('piece');
  });
});
