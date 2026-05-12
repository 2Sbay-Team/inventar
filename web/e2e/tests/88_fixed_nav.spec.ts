import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.8 — bottom nav + shop header must stay pinned to the visible
// viewport regardless of content length. The merchant-reported
// regression: with a long list of articles, the bottom nav scrolled
// with the page, so reaching Search / Dashboard / Settings required
// scrolling through the entire catalogue.
//
// Architecture change in ScreenLayout:
//   shell: min-h-screen  →  h-[100dvh]   (viewport-exact, not "at least")
//   children:             +min-h-0       (so flex-1 actually constrains)
// BottomNav: pb-5 → pb-[calc(env(safe-area-inset-bottom)+0.5rem)]
// ShopHeader: + sticky top-0 z-30 bg-paper
//
// These specs pin the contract on a 50-article catalogue. The
// existing 85_fab.spec.ts:long-scroll case already exercises the
// FAB-stays-pinned half of the same problem.

async function seedFiftyArticles(page: Page, lang: 'en' | 'fr' | 'ar'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang,
    shopName: 'Tall Catalogue',
    storeType: 'fashion',
    fashionSubtypes: ['shoes'],
  });
  await page.evaluate(async (locale) => {
    const api = window.__inventarSeed!;
    const articles = Array.from({ length: 50 }, (_, i) => ({
      name: `Article ${String(i + 1).padStart(2, '0')}`,
      category: 'sport' as const,
      sizes: [{ size: '42', qty: 5 }],
    }));
    await (api.seed as (i: unknown) => Promise<void>)({
      shopName: 'Tall Catalogue',
      locale,
      storeType: 'fashion',
      fashionSubtypes: ['shoes'],
      articles,
      reset: false,
    });
  }, lang);
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
}

async function navBoundingBox(page: Page): Promise<{ top: number; bottom: number; x: number }> {
  const box = await page.getByTestId('bottom-nav').boundingBox();
  if (!box) throw new Error('bottom-nav box not available');
  return { top: box.y, bottom: box.y + box.height, x: box.x };
}

test.describe('v0.6.8 — bottom nav + header stay pinned', () => {
  test('long-scroll on /: nav stays at the same viewport y, header stays at top', async ({
    page,
  }) => {
    await seedFiftyArticles(page, 'en');

    const navBefore = await navBoundingBox(page);
    const headerBefore = await page.getByTestId('shop-header').boundingBox();
    if (!headerBefore) throw new Error('shop-header not visible before scroll');

    // Scroll the inner result list. Use the main element rather than
    // window scroll — the fix moved the scrollable container inward,
    // so window scroll is a no-op.
    await page
      .getByTestId('search-screen')
      .evaluate((el) => el.scrollBy({ top: 5000, behavior: 'instant' as ScrollBehavior }));
    // Give layout one frame to settle.
    await page.waitForTimeout(80);

    const navAfter = await navBoundingBox(page);
    const headerAfter = await page.getByTestId('shop-header').boundingBox();
    if (!headerAfter) throw new Error('shop-header not visible after scroll');

    // Nav top + bottom unchanged within 2px (subpixel rounding).
    expect(Math.abs(navAfter.top - navBefore.top)).toBeLessThan(2);
    expect(Math.abs(navAfter.bottom - navBefore.bottom)).toBeLessThan(2);
    // Header top stays anchored at the same viewport y.
    expect(Math.abs(headerAfter.y - headerBefore.y)).toBeLessThan(2);
  });

  test('nav is fully inside the viewport (bottom <= viewport.height)', async ({ page }) => {
    await seedFiftyArticles(page, 'en');
    const nav = await navBoundingBox(page);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('viewport not available');
    // Allow up to 2px tolerance for safe-area-inset rendering.
    expect(nav.bottom).toBeLessThanOrEqual(viewport.height + 2);
  });

  test('FAB sits above the nav (no vertical overlap)', async ({ page }) => {
    await seedFiftyArticles(page, 'en');
    const fab = await page.getByTestId('fab').boundingBox();
    const nav = await page.getByTestId('bottom-nav').boundingBox();
    if (!fab || !nav) throw new Error('fab or nav box missing');
    // FAB's bottom edge must be above (smaller y) the nav's top edge.
    expect(fab.y + fab.height).toBeLessThan(nav.y);
  });

  test('AR locale: header stays sticky AND nav stays pinned', async ({ page }) => {
    await seedFiftyArticles(page, 'ar');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');

    const navBefore = await navBoundingBox(page);
    const headerBefore = await page.getByTestId('shop-header').boundingBox();
    if (!headerBefore) throw new Error('shop-header not visible before scroll');

    await page
      .getByTestId('search-screen')
      .evaluate((el) => el.scrollBy({ top: 5000, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(80);

    const navAfter = await navBoundingBox(page);
    const headerAfter = await page.getByTestId('shop-header').boundingBox();
    if (!headerAfter) throw new Error('shop-header not visible after scroll');

    expect(Math.abs(navAfter.top - navBefore.top)).toBeLessThan(2);
    expect(Math.abs(headerAfter.y - headerBefore.y)).toBeLessThan(2);
  });
});
