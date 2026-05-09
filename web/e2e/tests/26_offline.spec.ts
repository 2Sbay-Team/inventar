import { expect, test } from '@playwright/test';
import { onboardViaUI } from '../helpers/onboarding';

// "If I install the app, will it actually work without internet?"
//
// This proves it: load the production build (vite preview ships the same
// bundle as production, with the SW + manifest), wait for the service
// worker to take control, cut the network, then drive the app through a
// realistic offline session — switch screens, write a movement, reload
// the tab. If any of that needs the network, this test goes red.

test.describe('PWA offline behavior', () => {
  test('after first load, the app navigates and writes data with no network', async ({
    page,
    context,
  }) => {
    await page.goto('/');

    // The SW only registers in production builds; vite preview gives us
    // exactly that. Wait for it to reach 'activated' and start
    // controlling the page so all precaching is complete before we cut
    // the network.
    await page.waitForFunction(
      async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) return false;
        const sw = reg.active;
        if (!sw) return false;
        return sw.state === 'activated' && Boolean(navigator.serviceWorker.controller);
      },
      undefined,
      { timeout: 15_000 },
    );

    await onboardViaUI(page, { lang: 'en', shopName: 'Offline Shop' });

    // Seed one sized article so we have something to navigate to and
    // something to write a movement against.
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Offline Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Offline Sneaker',
            colors: ['white'],
            sizes: [{ size: '40', qty: 5 }],
          },
        ],
      });
    });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // ---- Cut the network. From here on, anything requiring a fetch to
    // ---- the origin or beyond should fail unless it's served from cache.
    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    // 1) Navigate via SPA routing — the bundle should already be in cache.
    await page.getByTestId('search-input').fill('offline');
    const card = page.getByTestId('result-card').first();
    await expect(card).toBeVisible({ timeout: 4000 });
    await card.click();
    await expect(page.getByTestId('hero-photo')).toBeVisible();

    // 2) Write a sale offline — IndexedDB lives client-side, so this must
    //    just work. Default reason is sale, default delta is 1, so confirming
    //    drops stock from 5 to 4.
    await expect(page.getByTestId('stock-total')).toContainText('5');
    await page.getByTestId('size-cell-40').click();
    await expect(page.getByTestId('quick-adjust-sheet')).toBeVisible();
    await page.getByTestId('adjust-confirm').click();
    await expect(page.getByTestId('stock-total')).toContainText('4');

    // 3) Hard reload while offline — the SW must serve index.html from
    //    its precache (navigateFallback: '/index.html'), and IndexedDB
    //    must still have our data. If the network were required, this
    //    reload would die in the browser's offline page. We're on the
    //    /article/:id deep link, so the article detail must come back
    //    with the post-sale stock value persisted (4).
    await page.reload();
    await expect(page.getByTestId('hero-photo')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('stock-total')).toContainText('4');

    // 4) Cross-screen navigation while offline. From article-detail, go
    //    back to search, then exercise the bottom nav.
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await page.getByTestId('search-input').fill('offline');
    await expect(page.getByTestId('result-card').first()).toBeVisible({ timeout: 4_000 });

    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();

    await context.setOffline(false);
  });
});
