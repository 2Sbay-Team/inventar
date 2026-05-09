import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// The active nav item gets a soft accent pill behind icon + label.
// --accent-soft = #FFE4D6 = rgb(255, 228, 214).

const ACCENT_SOFT = 'rgb(255, 228, 214)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function bgColour(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe('bottom nav active pill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Nav Pill' });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('Search has the pill on /, then moves to Dashboard after navigation', async ({ page }) => {
    expect(await bgColour(page, 'nav-search')).toBe(ACCENT_SOFT);
    expect(await bgColour(page, 'nav-dashboard')).toBe(TRANSPARENT);

    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();

    expect(await bgColour(page, 'nav-dashboard')).toBe(ACCENT_SOFT);
    expect(await bgColour(page, 'nav-search')).toBe(TRANSPARENT);
  });
});
