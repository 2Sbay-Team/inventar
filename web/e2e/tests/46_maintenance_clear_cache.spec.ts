import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.1: Settings → Maintenance section. Defensive escape hatch when
// a stale service worker has the device stuck on a broken precached
// shell. The button unregisters the SW + clears Cache Storage + hard-
// reloads. IndexedDB (the merchant's data) is deliberately untouched.

test.describe('Settings — Maintenance / Clear app cache', () => {
  test('section visible; button opens confirm; cancel dismisses', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Maintenance Test',
      storeType: 'shoes',
    });

    await page.getByTestId('nav-settings').click();
    const section = page.getByTestId('section-maintenance');
    await expect(section).toBeVisible();
    // Confirm step is hidden by default — the button alone is the
    // first interaction.
    await expect(page.getByTestId('clear-cache-confirm')).toHaveCount(0);

    await page.getByTestId('clear-cache').click();
    await expect(page.getByTestId('clear-cache-confirm')).toBeVisible();
    // Both buttons are reachable + enabled in the unconfirmed state.
    await expect(page.getByTestId('clear-cache-cancel')).toBeEnabled();
    await expect(page.getByTestId('clear-cache-confirm-btn')).toBeEnabled();

    // Cancel collapses the confirm section without touching anything.
    await page.getByTestId('clear-cache-cancel').click();
    await expect(page.getByTestId('clear-cache-confirm')).toHaveCount(0);
    await expect(page.getByTestId('section-maintenance')).toBeVisible();
  });

  test('confirm → triggers a navigation (the page reloads itself)', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Maintenance Confirm',
      storeType: 'shoes',
    });

    await page.getByTestId('nav-settings').click();
    await page.getByTestId('clear-cache').click();
    // Wait for the reload-driven navigation — page.waitForLoadState
    // resolves on the next 'load' event, which a same-URL reload
    // also fires.
    const reloaded = page.waitForLoadState('load');
    await page.getByTestId('clear-cache-confirm-btn').click();
    await reloaded;
    // After reload we land back at the same /settings URL because
    // the path was the active route. The Maintenance section is
    // visible again, no crash.
    await expect(page.getByTestId('section-maintenance')).toBeVisible();
  });
});
