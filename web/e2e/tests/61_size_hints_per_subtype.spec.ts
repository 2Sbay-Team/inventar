import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2 ADR-018 — sub-type-aware size hints in Add Article. The size
// input renders an HTML datalist whose options come from the union of
// SIZE_HINT_VALUES for the merchant's selected fashion subtypes. The
// datalist is empty (and not rendered) when:
//   - storeType !== 'fashion' (no sizes column at all), OR
//   - every selected subtype has size_hint='none' (accessories, bags,
//     jewelry).

test.describe('Add Article — size hints per fashion subtype', () => {
  test('shoes subtype: datalist contains numeric_eu values (36, 42, 46)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Shoes Test',
      storeType: 'fashion',
      fashionSubtypes: ['shoes'],
    });
    await page.reload();
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Trainer');
    await page.getByTestId('continue').click();

    const datalist = page.getByTestId('block-0-size-hints');
    await expect(datalist).toHaveCount(1);
    const values = await datalist.evaluate((el) =>
      Array.from(el.querySelectorAll('option')).map((o) => o.value),
    );
    expect(values).toContain('36');
    expect(values).toContain('42');
    expect(values).toContain('46');
    // No letter sizes for shoes.
    expect(values).not.toContain('XS');
  });

  test('clothing_men subtype: datalist contains letter sizes (XS-XXXL)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Mens Test',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Shirt');
    await page.getByTestId('continue').click();

    const values = await page
      .getByTestId('block-0-size-hints')
      .evaluate((el) => Array.from(el.querySelectorAll('option')).map((o) => o.value));
    expect(values).toContain('XS');
    expect(values).toContain('XXXL');
    expect(values).not.toContain('36');
  });

  test('accessories subtype: NO datalist (size_hint=none)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Accessories Test',
      storeType: 'fashion',
      fashionSubtypes: ['accessories'],
    });
    await page.reload();
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Belt');
    await page.getByTestId('continue').click();

    // Sizes column itself still renders for fashion verticals; the
    // datalist just doesn't, since accessories has size_hint='none'.
    await expect(page.getByTestId('block-0-size-hints')).toHaveCount(0);
  });

  test('multiple subtypes: union of values (shoes + clothing_men)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Combo Test',
      storeType: 'fashion',
      fashionSubtypes: ['shoes', 'clothing_men'],
    });
    await page.reload();
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Item');
    await page.getByTestId('continue').click();

    const values = await page
      .getByTestId('block-0-size-hints')
      .evaluate((el) => Array.from(el.querySelectorAll('option')).map((o) => o.value));
    expect(values).toContain('36');
    expect(values).toContain('XS');
  });
});
