import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// N+1  TND appears in the priority list at the top of the currency picker
// N+2  EUR, USD, MAD, DZD appear in the priority list
// N+3  Searching "TND" filters to show TND immediately
// N+4  Searching "Euro" or "EUR" finds EUR
// N+5  All other currencies remain available below the divider
// N+6  Settings section headers all render their title text
// N+7  Settings sections expand and collapse when their header is tapped
// N+8  Section summaries show correct values when collapsed

async function goToSettings(page: Page): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang: 'en', shopName: 'CurrencyTest' });
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
}

async function openCurrencyPicker(page: Page): Promise<void> {
  // The currency picker is inside section-shop-profile. Open the section
  // first so the trigger button is accessible.
  await page.getByTestId('section-shop-profile-header').click();
  await expect(page.locator('[data-testid="section-shop-profile-body"]')).toBeVisible({
    timeout: 2_000,
  });
  await page.getByTestId('settings-currency').click();
  await expect(page.getByTestId('currency-picker-dialog')).toBeVisible({ timeout: 3_000 });
}

test.describe('Currency picker', () => {
  test('N+1: TND appears in the priority list at the top', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    // Priority list must be visible and contain TND.
    const priority = page.getByTestId('currency-priority-list');
    await expect(priority).toBeVisible();
    await expect(page.getByTestId('currency-option-TND')).toBeVisible();

    // TND must appear BEFORE the divider — i.e. it's in the priority section.
    const tndY = await page.getByTestId('currency-option-TND').boundingBox();
    const dividerY = await page.getByTestId('currency-divider').boundingBox();
    expect(tndY).not.toBeNull();
    expect(dividerY).not.toBeNull();
    expect(tndY!.y).toBeLessThan(dividerY!.y);
  });

  test('N+2: EUR, USD, MAD, DZD all appear in the priority list', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    const priority = page.getByTestId('currency-priority-list');
    await expect(priority).toBeVisible();

    for (const code of ['EUR', 'USD', 'MAD', 'DZD']) {
      await expect(page.getByTestId(`currency-option-${code}`)).toBeVisible();
      const optY = await page.getByTestId(`currency-option-${code}`).boundingBox();
      const dividerY = await page.getByTestId('currency-divider').boundingBox();
      expect(optY!.y, `${code} should be above divider`).toBeLessThan(dividerY!.y);
    }
  });

  test('N+3: searching "TND" filters the list to show TND', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    await page.getByTestId('currency-search-input').fill('TND');

    // TND must be visible.
    await expect(page.getByTestId('currency-option-TND')).toBeVisible({ timeout: 1_000 });
    // The divider disappears when searching (single merged list).
    await expect(page.getByTestId('currency-divider')).toHaveCount(0);
    // A currency far from TND alphabetically (e.g. ZWL) should not be
    // visible — confirming the list is filtered, not just reordered.
    // We can't assert on a specific code since the full list is 150+,
    // but we can confirm the all-currencies section no longer shows
    // currencies that don't match "TND".
    const allList = page.getByTestId('currency-all-list');
    const allListCount = await allList.locator('[data-testid^="currency-option-"]').count();
    // allList should either be empty or contain only TND-matched codes.
    // Searching "TND" only matches TND itself, so allList should be 0.
    expect(allListCount).toBe(0);
  });

  test('N+4: searching "Euro" finds EUR', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    await page.getByTestId('currency-search-input').fill('Euro');
    await expect(page.getByTestId('currency-option-EUR')).toBeVisible({ timeout: 1_000 });
  });

  test('N+4 alt: searching "EUR" finds EUR', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    await page.getByTestId('currency-search-input').fill('EUR');
    await expect(page.getByTestId('currency-option-EUR')).toBeVisible({ timeout: 1_000 });
  });

  test('N+5: non-priority currencies are visible below the divider', async ({ page }) => {
    await goToSettings(page);
    await openCurrencyPicker(page);

    // The "all currencies" section below the divider must be present.
    const allList = page.getByTestId('currency-all-list');
    await expect(allList).toBeVisible();

    // JPY is a well-known currency that is not in the priority list —
    // it should appear below the divider.
    const jpyOption = page.getByTestId('currency-option-JPY');
    await expect(jpyOption).toBeVisible();
    const jpyY = await jpyOption.boundingBox();
    const dividerY = await page.getByTestId('currency-divider').boundingBox();
    expect(jpyY!.y, 'JPY should be below the priority divider').toBeGreaterThan(dividerY!.y);
  });
});

test.describe('Settings section headers', () => {
  test('N+6: all Settings section headers render their title text', async ({ page }) => {
    await goToSettings(page);

    // Check a representative set of section header titles by verifying
    // the title span (data-testid="section-{id}-title") has non-empty
    // visible text. This confirms the min-h / flex fix resolved the
    // blank-pill regression on iOS Safari.
    const sectionIds = ['language', 'shop-profile', 'backup'];
    for (const id of sectionIds) {
      const title = page.getByTestId(`section-${id}-title`);
      await expect(title).toBeVisible({ timeout: 5_000 });
      const text = await title.textContent();
      expect(text?.trim().length, `section-${id} title should not be empty`).toBeGreaterThan(0);
    }
  });

  test('N+7: settings sections expand and collapse when header is tapped', async ({ page }) => {
    await goToSettings(page);

    // Language section: starts closed, expands on click, collapses on second click.
    const header = page.getByTestId('section-language-header');
    const body = page.getByTestId('section-language-body');

    // Confirm initial closed state — body height should be 0 / not interactable.
    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute('aria-expanded', 'false');

    // Open.
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    // The language radio buttons or content must now be accessible.
    await expect(page.getByTestId('settings-lang-en')).toBeVisible({ timeout: 2_000 });

    // Close.
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    // Body still in DOM (animation keeps it), but lang buttons are no
    // longer interactive (inside height-0 overflow-hidden container).
    // The testid on the body itself is always present.
    await expect(body).toBeAttached();
  });

  test('N+8: section summary shows correct value when collapsed', async ({ page }) => {
    await goToSettings(page);

    // Language section summary — for en onboard the summary = "English".
    const langSummary = page.getByTestId('section-language-summary');
    await expect(langSummary).toBeVisible();
    const summaryText = await langSummary.textContent();
    expect(summaryText?.trim()).toBe('English');
  });
});
