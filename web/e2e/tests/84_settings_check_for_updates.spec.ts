import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.3 — Settings → About → "Check for updates" surface. The
// background snooze-aware path keeps its existing test coverage
// (77_update_consent); this spec covers the merchant-initiated
// branch — i.e. the button — and its three outcomes:
//
//   • found    → consent modal opens (bypasses snooze/skip).
//   • online   → no waiting SW → "latest" toast.
//   • offline  → short-circuits before any registration probe → "offline"
//                toast.
//
// The "found" branch is hard to drive deterministically without a real
// SW deploy — playwright would need to ship a second bundle to the
// preview server mid-test. The fake SwHandle that 77's
// triggerUpdateWaiting uses doesn't help here, because checkForUpdates
// reads navigator.serviceWorker.getRegistration directly (the real
// browser API). For now this spec pins the two toast-rendering paths
// and leaves the modal-opens path to the existing 77/80 coverage; if a
// regression sneaks the "found" branch past those, the unit-level
// AppUpdate contract in use-app-update.test.ts will still flag it.

async function gotoSettingsAbout(page: Page, lang: 'en' | 'fr' | 'ar'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'Update Check Shop' });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('section-about')).toBeVisible();
}

test.describe('v0.6.3 — Settings → About → manual update check', () => {
  test('renders the version + check-for-updates button in all three locales', async ({ page }) => {
    // EN.
    await gotoSettingsAbout(page, 'en');
    await expect(page.getByTestId('about-version')).toContainText('v1.0.1');
    await expect(page.getByTestId('about-check-updates')).toContainText('Check for updates');

    // FR — switch the active locale via the existing Settings buttons.
    await page.getByTestId('settings-lang-fr').click();
    await expect(page.getByTestId('about-check-updates')).toContainText(
      'Vérifier les mises à jour',
    );

    // AR — string + RTL direction inherited from <html dir>.
    await page.getByTestId('settings-lang-ar').click();
    await expect(page.getByTestId('about-check-updates')).toContainText('التحقق من التحديثات');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
  });

  test('offline tap → "offline" toast, auto-clears after the timeout', async ({
    page,
    context,
  }) => {
    await gotoSettingsAbout(page, 'en');
    // Cut network at the browser-context level so navigator.onLine
    // flips to false. checkForUpdates short-circuits the
    // registration probe on !navigator.onLine — we don't want a
    // hanging reg.update() call to make the test flaky.
    await context.setOffline(true);
    await page.getByTestId('about-check-updates').click();
    await expect(page.getByTestId('about-toast-offline')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('about-toast-offline')).toContainText(
      "Can't check for updates — you're offline",
    );
    // The toast auto-clears via the 4 s setTimeout inside
    // AboutSection. Allow a generous window so a slow CI runner
    // doesn't fail just because the clear arrived a touch late.
    await expect(page.getByTestId('about-toast-offline')).toBeHidden({ timeout: 8_000 });
    await context.setOffline(false);
  });

  test('online tap with no new SW → "latest" toast', async ({ page }) => {
    await gotoSettingsAbout(page, 'en');
    // The preview server's bundle hasn't changed mid-test, so the
    // browser's reg.update() will not find a new SW. checkForUpdates
    // sleeps 1.5 s, re-checks registration.waiting, sees nothing,
    // returns { found: false, online: true } → "latest" toast.
    await page.getByTestId('about-check-updates').click();
    await expect(page.getByTestId('about-toast-latest')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('about-toast-latest')).toContainText(
      "You're on the latest version",
    );
  });
});
