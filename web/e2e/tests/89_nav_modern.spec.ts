import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.9 — bottom-nav visual refresh + literal `position: fixed`.
// v0.6.8 pinned the nav to the visible viewport via the h-dvh shell
// trick; v0.6.9 goes the textbook M3 / iOS 18 route: rounded top
// corners, backdrop blur, soft upward shadow, active-tab pill
// indicator that fades in/out over 200 ms. This spec pins:
//
//   1. Computed `position: fixed` on the nav (browsers normalise
//      the Tailwind utility into the same CSSStyleDeclaration value).
//   2. The active tab's pill indicator carries the `data-state=active`
//      attribute; switching tabs moves the marker.
//   3. The FAB's bottom edge clears the nav's top edge — verified
//      via bounding boxes on a 50-article catalogue under both LTR
//      and RTL locales.
//
// Tab-fixing tests for "long scroll keeps nav visible" still live
// in 88_fixed_nav.spec.ts (they pass on both the v0.6.8 and v0.6.9
// implementations — same behavioural outcome via two architectural
// routes).

async function gotoSearch(
  page: Page,
  lang: 'en' | 'fr' | 'ar' = 'en',
  options: { seedArticle?: boolean } = { seedArticle: true },
): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'Nav Test Shop' });
  // v0.9 — the FAB self-hides on the Products empty-state to avoid
  // duplicating the centred "Add your first article" CTA. Tests that
  // measure FAB geometry need at least one article in the catalogue.
  if (options.seedArticle !== false) {
    await page.evaluate(async (locale) => {
      await window.__inventarSeed!.seed({
        shopName: 'Nav Test Shop',
        locale,
        articles: [{ name: 'Nav Seeded Article', sizes: [{ size: '42', qty: 1 }] }],
        reset: false,
      });
    }, lang);
  }
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
}

test.describe('v0.6.9 — modern fixed bottom nav', () => {
  test('nav is position: fixed (computed), at bottom-0, full-width', async ({ page }) => {
    await gotoSearch(page);
    const css = await page.getByTestId('bottom-nav').evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        position: s.position,
        bottom: s.bottom,
        left: s.left,
        right: s.right,
        zIndex: s.zIndex,
      };
    });
    expect(css.position).toBe('fixed');
    expect(css.bottom).toBe('0px');
    expect(css.left).toBe('0px');
    expect(css.right).toBe('0px');
    expect(Number(css.zIndex)).toBeGreaterThanOrEqual(30);
  });

  test("active tab carries data-state='active' on its indicator; switching moves the marker", async ({
    page,
  }) => {
    // v0.7 ADR-037 — nav-list is gone; the test now hops Articles →
    // Dashboard → Settings to exercise pill movement across the
    // four-tab layout.
    await gotoSearch(page);
    // Initial route is /, so the Articles tab (nav-search testid) is active.
    await expect(page.getByTestId('nav-products-indicator')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('nav-reports-indicator')).toHaveAttribute(
      'data-state',
      'inactive',
    );

    await page.getByTestId('nav-reports').click();
    await expect(page).toHaveURL(/\/reports$/);
    await expect(page.getByTestId('nav-reports-indicator')).toHaveAttribute('data-state', 'active');
    await expect(page.getByTestId('nav-products-indicator')).toHaveAttribute(
      'data-state',
      'inactive',
    );

    await page.getByTestId('nav-settings').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('nav-settings-indicator')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('nav-reports-indicator')).toHaveAttribute(
      'data-state',
      'inactive',
    );
  });

  test('FAB bottom edge clears nav top edge — LTR (FAB on right)', async ({ page }) => {
    await gotoSearch(page);
    const fab = await page.getByTestId('fab').boundingBox();
    const nav = await page.getByTestId('bottom-nav').boundingBox();
    if (!fab || !nav) throw new Error('fab or nav box missing');
    expect(fab.y + fab.height).toBeLessThan(nav.y);
    // FAB x sits in the right half of the shell under LTR.
    const shell = await page.getByTestId('app-shell').boundingBox();
    if (!shell) throw new Error('shell box not available');
    expect(fab.x).toBeGreaterThan(shell.x + shell.width / 2);
  });

  test('FAB clears nav under RTL too, and shifts to the left half of the shell', async ({
    page,
  }) => {
    await gotoSearch(page, 'ar');
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    const fab = await page.getByTestId('fab').boundingBox();
    const nav = await page.getByTestId('bottom-nav').boundingBox();
    const shell = await page.getByTestId('app-shell').boundingBox();
    if (!fab || !nav || !shell) throw new Error('fab / nav / shell box missing');
    expect(fab.y + fab.height).toBeLessThan(nav.y);
    expect(fab.x).toBeLessThan(shell.x + shell.width / 2);
  });

  test('nav has rounded top corners and a translucent backdrop', async ({ page }) => {
    await gotoSearch(page);
    const visual = await page.getByTestId('bottom-nav').evaluate((el) => {
      const s = window.getComputedStyle(el);
      return {
        borderTopLeftRadius: s.borderTopLeftRadius,
        borderTopRightRadius: s.borderTopRightRadius,
        // backdropFilter shows up as 'blur(<px>)' when Tailwind's
        // backdrop-blur-md compiles. Some test browsers report it
        // under -webkit prefix; cover both.
        backdropFilter:
          (s as CSSStyleDeclaration & { webkitBackdropFilter?: string }).backdropFilter ||
          (s as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter ||
          '',
        // Translucent background — should NOT be a fully-opaque white.
        backgroundColor: s.backgroundColor,
      };
    });
    expect(visual.borderTopLeftRadius).toBe('20px');
    expect(visual.borderTopRightRadius).toBe('20px');
    expect(visual.backdropFilter).toMatch(/blur/);
    // Translucent: rgba alpha component < 1.
    expect(visual.backgroundColor).toMatch(/rgba?\(.*,\s*0?\.\d+\s*\)$/);
  });
});
