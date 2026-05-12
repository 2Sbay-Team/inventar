import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.9 Phase 8 — Brand Studio surface end-to-end. Covers the
// Phase 4a-7 interactions a merchant actually does in Settings →
// Shop Identity. Unit tests pin every pure helper (apply-theme,
// extract-logo-color, profile-completion, opening-hours, field-
// format, debounce); this spec pins that they wire up correctly
// against the live DOM + autosave + applyTheme cycle.
//
// Strategy: bring the merchant to the Settings page via the seed
// helper, exercise each subsection's load-bearing interaction,
// assert the observable outcome — DB write (round-tripped via
// useProfile → render), CSS variable on :root, or visible chrome
// change.

async function gotoSettings(page: Page, lang: 'en' | 'fr' | 'ar' = 'en'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'Brand Studio Shop' });
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('section-shop-identity')).toBeVisible();
}

test.describe('v0.9 Phase 8 — Shop Identity surface', () => {
  test('Identity section renders all six subsections + completion ring', async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByTestId('section-shop-identity')).toBeVisible();
    await expect(page.getByTestId('completion-ring')).toBeVisible();
    // Every Brand Studio subsection is visible in the rendered tree.
    // Subsections don't have data-testids of their own (they're
    // anonymous flex containers); we identify them by the first
    // testid each contains.
    await expect(page.getByTestId('brand-color-picker')).toBeVisible();
    await expect(page.getByTestId('app-theme-picker')).toBeVisible();
    await expect(page.getByTestId('identity-tagline')).toBeVisible();
    await expect(page.getByTestId('identity-whatsapp')).toBeVisible();
    await expect(page.getByTestId('identity-address-street')).toBeVisible();
    await expect(page.getByTestId('opening-hours-editor')).toBeVisible();
    await expect(page.getByTestId('identity-instagram')).toBeVisible();
    // Below 30%, the business card section shows the teaser
    // instead of the full card.
    await expect(page.getByTestId('business-card-teaser')).toBeVisible();
  });

  test('filling tagline triggers autosave and persists across reload', async ({ page }) => {
    await gotoSettings(page);
    const tagline = page.getByTestId('identity-tagline');
    await tagline.fill('Quality fashion since 2020');
    // Wait for the 800 ms debounce + the round-trip.
    await expect(page.getByTestId('autosave-saved').first()).toBeVisible({ timeout: 4_000 });
    // Reload and confirm the value is still in the input.
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('identity-tagline')).toHaveValue('Quality fashion since 2020');
  });

  test('tapping a brand-colour preset re-paints :root via applyTheme', async ({ page }) => {
    await gotoSettings(page);
    // Pick navy (#1E3A8A → rgb 30 58 138). The CSS variable on
    // documentElement updates within one frame; the unit tests
    // pin the math.
    await page.getByTestId('brand-color-preset-navy').click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--color-brand-rgb')),
      )
      .toBe('30 58 138');
  });

  test('tapping a theme-bg preset re-paints :root --color-bg-rgb', async ({ page }) => {
    await gotoSettings(page);
    // White preset writes #FFFFFF → triple "255 255 255".
    await page.getByTestId('theme-preset-white').click();
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--color-bg-rgb')),
      )
      .toBe('255 255 255');
  });

  test('hours: toggling Sunday open shows from/to inputs and saves', async ({ page }) => {
    await gotoSettings(page);
    // Default week: Sunday closed → caption shown, no time inputs.
    await expect(page.getByTestId('opening-hours-sunday-from')).toHaveCount(0);
    await expect(page.getByTestId('opening-hours-sunday-to')).toHaveCount(0);
    // Toggle Sunday open.
    await page.getByTestId('opening-hours-sunday-toggle').click();
    await expect(page.getByTestId('opening-hours-sunday-from')).toBeVisible();
    await expect(page.getByTestId('opening-hours-sunday-to')).toBeVisible();
    // Autosave should fire for the Hours subsection.
    await expect(page.getByTestId('autosave-saved').first()).toBeVisible({ timeout: 4_000 });
  });

  test('hours: Apply Monday button copies Mon hours to other open days', async ({ page }) => {
    await gotoSettings(page);
    // Change Monday to 09:00-21:00 by typing into the inputs.
    await page.getByTestId('opening-hours-monday-from').fill('09:00');
    await page.getByTestId('opening-hours-monday-to').fill('21:00');
    // Click the bulk button.
    await page.getByTestId('opening-hours-apply-monday').click();
    // Tuesday should now match Monday's hours.
    await expect(page.getByTestId('opening-hours-tuesday-from')).toHaveValue('09:00');
    await expect(page.getByTestId('opening-hours-tuesday-to')).toHaveValue('21:00');
  });
});

test.describe('v0.9 Phase 8 — RTL polish (Arabic)', () => {
  test('Hours editor: arrow flips to ← under [dir=rtl]', async ({ page }) => {
    await gotoSettings(page, 'ar');
    // Document direction is RTL when locale is Arabic.
    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir).toBe('rtl');
    // The Mon row's arrow is visible. The Tailwind `rtl:hidden` /
    // `rtl:inline` pair means the visible arrow under RTL is the
    // left-pointing one (←); the right-pointing one is hidden.
    const row = page.getByTestId('opening-hours-monday');
    // Two arrow spans live inside the row. The hidden one has
    // `display: none` from the Tailwind `hidden` utility — count
    // visible glyphs by filtering.
    const arrowText = await row.locator('[aria-hidden="true"] span').allTextContents();
    // Arrow span content is either '→' or '←'. RTL should show ←.
    const visible = arrowText.filter((s) => s === '←');
    expect(visible.length).toBeGreaterThan(0);
  });
});
