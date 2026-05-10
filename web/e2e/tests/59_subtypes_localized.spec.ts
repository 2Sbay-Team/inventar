import { expect, test } from '@playwright/test';

// v0.5.2 ADR-018 — subtype labels translate via i18next; custom strings
// display verbatim in every locale. Tested here against the AR locale
// because that's the trickiest (RTL + non-Latin script).

test.describe('Subtypes — localized labels (AR)', () => {
  test('shop subtypes show Arabic labels in the picker', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('متجر');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-shop-subtypes')).toBeVisible();

    // food_beverages chip carries the Arabic label.
    const chip = page.getByTestId('onb-subtype-food_beverages');
    await expect(chip).toContainText('أطعمة ومشروبات');

    // fresh_produce (new in v0.5.2) has its Arabic label.
    await expect(page.getByTestId('onb-subtype-fresh_produce')).toContainText(
      'خضروات وفواكه طازجة',
    );
  });

  test('fashion subtypes show Arabic labels', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-fashion').click();
    await page.getByTestId('shop-name-input').fill('بوتيك');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();

    await expect(page.getByTestId('onb-subtype-shoes')).toContainText('أحذية');
    await expect(page.getByTestId('onb-subtype-clothing_women')).toContainText('ملابس نسائية');
  });

  test('custom subtypes display verbatim in AR (no translation attempted)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-ar').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('متجر');
    await page.getByTestId('continue').click();

    await page.getByTestId('onb-custom-add').click();
    await page.getByTestId('onb-custom-input').fill('halal_meat');
    await page.getByTestId('onb-custom-save').click();
    // Verbatim Latin string in an AR session — proves the picker
    // doesn't try to localize custom keys.
    await expect(page.getByTestId('onb-custom-chip-halal_meat')).toContainText('halal_meat');
  });
});
