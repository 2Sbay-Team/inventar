import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// The app shell scales progressively with viewport size — see ScreenLayout
// for the full tier list. Below 600px the shell is full-width so a real
// phone fills the screen; at 1920px we expect the largest tier (880px),
// horizontally centred.

test.describe('app shell max-width — wide viewport', () => {
  test.use({ viewport: { width: 1920, height: 1080 }, isMobile: false });

  test('shell is capped at 880px and horizontally centred at 1920px', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Layout Wide' });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const shell = page.getByTestId('app-shell');
    await expect(shell).toBeVisible();

    const maxWidth = await shell.evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe('880px');

    const { rect, viewportWidth } = await shell.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        rect: { left: r.left, right: r.right, width: r.width },
        viewportWidth: window.innerWidth,
      };
    });
    expect(rect.width).toBe(880);
    const leftGap = rect.left;
    const rightGap = viewportWidth - rect.right;
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
  });
});

test.describe('app shell max-width — narrow viewport', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: false });

  test('shell is unconstrained / full-viewport below 600px', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Layout Narrow' });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const shell = page.getByTestId('app-shell');
    await expect(shell).toBeVisible();

    const maxWidth = await shell.evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe('none');

    const width = await shell.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBe(375);
  });
});
