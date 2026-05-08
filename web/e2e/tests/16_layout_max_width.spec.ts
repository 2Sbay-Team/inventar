import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// SPEC §6 / mockup §1 — the app shell stays phone-shaped on desktop:
// max-width 480px above the 600px breakpoint, centred horizontally.
// Below 600px the shell is full-width so a real phone fills the screen.

test.describe('app shell max-width — wide viewport', () => {
  test.use({ viewport: { width: 1920, height: 1080 }, isMobile: false });

  test('shell is capped at 480px and horizontally centred', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Layout Wide' });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    const shell = page.getByTestId('app-shell');
    await expect(shell).toBeVisible();

    const maxWidth = await shell.evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe('480px');

    const { rect, viewportWidth } = await shell.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        rect: { left: r.left, right: r.right, width: r.width },
        viewportWidth: window.innerWidth,
      };
    });
    expect(rect.width).toBe(480);
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
