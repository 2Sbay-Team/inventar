import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.7 — pre-v0.6.9 this spec asserted the NavLink wrapper's
// background-color (rgb(255, 228, 214) = accent-soft). v0.6.9 moved
// the pill to a dedicated span inside the link (`{testId}-indicator`)
// and drives it via `data-state="active|inactive"` for transition
// fidelity, with `bg-accent/[0.12]` as the active fill. v0.7 then
// dropped the search/list/add/receive tabs in favour of Articles /
// Sell / Dashboard / Settings — `nav-search` testid stays on the
// Articles tab.
//
// The contract pinned by this spec now is: the active tab's
// indicator span has `data-state="active"` and a translucent accent
// fill; inactive tabs' indicators have `data-state="inactive"` and
// transparent background.

test.describe('bottom nav active pill (v0.7)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Nav Pill' });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('Articles has the pill on /, then moves to Dashboard after navigation', async ({ page }) => {
    await expect(page.getByTestId('nav-products-indicator')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('nav-reports-indicator')).toHaveAttribute(
      'data-state',
      'inactive',
    );

    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();

    await expect(page.getByTestId('nav-reports-indicator')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('nav-products-indicator')).toHaveAttribute(
      'data-state',
      'inactive',
    );
  });

  test('active indicator has an accent-tinted background, inactive is transparent', async ({
    page,
  }) => {
    // Computed background-color carries an alpha-channel rgba on the
    // active tab (bg-accent/[0.12] → rgba(255, 107, 53, 0.12)) and the
    // default transparent on inactive. Match the alpha pattern rather
    // than hard-coding values so a theme tweak doesn't break this spec.
    const active = await page
      .getByTestId('nav-products-indicator')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const inactive = await page
      .getByTestId('nav-reports-indicator')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    // Active: rgba(r, g, b, α) with 0 < α < 1.
    expect(active).toMatch(/rgba?\(.*,\s*0?\.\d+\s*\)$/);
    // Inactive: transparent.
    expect(inactive).toBe('rgba(0, 0, 0, 0)');
  });
});
