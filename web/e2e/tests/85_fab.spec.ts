import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.4 — global Floating Action Button. Pinned to the inline end
// of the centred app shell, above the bottom nav. Self-determines
// visibility per route: shown on /, /list, /dashboard; hidden
// everywhere else. Tap → /add (/, /list) or dispatches the
// inventar:fab-trigger event (/dashboard → opens Add Expense).
//
// /article/:id is intentionally not on the visible-list — its
// existing action-bar already exposes Sell + Restock. See the
// matrix comment in src/components/fab.tsx.

async function gotoSearch(
  page: Page,
  lang: 'en' | 'fr' | 'ar' = 'en',
  options: { seedArticle?: boolean } = { seedArticle: true },
): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'FAB Shop' });
  // v0.9 — the FAB on /products hides itself when the catalogue is
  // empty (the empty-state already exposes a centred CTA), so most
  // FAB tests need at least one article seeded before they can
  // assert visibility. The single dedicated empty-state test below
  // calls this helper with seedArticle: false.
  if (options.seedArticle !== false) {
    await page.evaluate(async (locale) => {
      await window.__inventarSeed!.seed({
        shopName: 'FAB Shop',
        locale,
        articles: [{ name: 'Seeded Article', sizes: [{ size: '42', qty: 1 }] }],
        reset: false,
      });
    }, lang);
  }
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
}

test.describe('v0.6.4 — global FAB', () => {
  test('visible on /, /list, /dashboard; hidden on /add, /settings, /alerts, /help', async ({
    page,
  }) => {
    await gotoSearch(page);

    // /search (path: /) → FAB visible.
    await expect(page.getByTestId('fab')).toBeVisible();
    await expect(page.getByTestId('fab')).toHaveAttribute('aria-label', 'Add new article');

    // /list → FAB visible (route still serves ListScreen, just not
    // in the nav since v0.7 ADR-037 — direct URL only).
    await page.goto('/list');
    await expect(page.getByTestId('fab')).toBeVisible();
    await expect(page.getByTestId('fab')).toHaveAttribute('aria-label', 'Add new article');

    // /dashboard → FAB visible with the expense aria-label.
    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await expect(page.getByTestId('fab')).toBeVisible();
    await expect(page.getByTestId('fab')).toHaveAttribute('aria-label', 'Add expense');

    // /add → FAB hidden (we're already on the destination). /add
    // uses hideNav, so the bottom-nav is gone here; v0.7 also
    // dropped the nav-add tab in favour of the FAB. Reach via URL.
    await page.goto('/add');
    await expect(page.getByTestId('add-step-indicator')).toBeVisible();
    await expect(page.getByTestId('fab')).toBeHidden();

    // /settings → FAB hidden.
    await page.goto('/settings');
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await expect(page.getByTestId('fab')).toBeHidden();

    // /alerts → hidden.
    await page.goto('/alerts');
    await expect(page.getByTestId('fab')).toBeHidden();

    // /help → hidden.
    await page.goto('/help');
    await expect(page.getByTestId('fab')).toBeHidden();
  });

  test('tap on /list → navigates to /add', async ({ page }) => {
    await gotoSearch(page);
    await page.goto('/list');
    await expect(page.getByTestId('fab')).toBeVisible();
    await page.getByTestId('fab').click();
    // v0.8 — FAB navigates to /products/new (was /add); the legacy
    // /add path still redirects here so deep links and seed scripts
    // keep working, but a fresh FAB tap lands on the canonical URL.
    await expect(page).toHaveURL(/\/products\/new$/);
    await expect(page.getByTestId('add-step-indicator')).toBeVisible();
  });

  test('tap on /search → navigates to /add', async ({ page }) => {
    await gotoSearch(page);
    await page.getByTestId('fab').click();
    // v0.8 — FAB navigates to /products/new (was /add); the legacy
    // /add path still redirects here so deep links and seed scripts
    // keep working, but a fresh FAB tap lands on the canonical URL.
    await expect(page).toHaveURL(/\/products\/new$/);
    await expect(page.getByTestId('add-step-indicator')).toBeVisible();
  });

  test('tap on /dashboard → opens Add Expense dialog', async ({ page }) => {
    await gotoSearch(page);
    await page.getByTestId('nav-reports').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await page.getByTestId('fab').click();
    // The dashboard owns the dialog; the FAB only signals via the
    // document-level event. expense-sheet is the dialog's testid.
    await expect(page.getByTestId('expense-sheet')).toBeVisible({ timeout: 5_000 });
  });

  test('Arabic locale flips the FAB to the start (bottom-left in RTL)', async ({ page }) => {
    await gotoSearch(page, 'ar');
    // <html dir> goes to rtl; `end-6` resolves to left:24px under RTL.
    expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(page.getByTestId('fab')).toBeVisible();
    // Computed inline-end → physical left in RTL. Read the rendered
    // position so the assertion catches a regression that wires the
    // FAB to `right-6` (physical) instead of `end-6` (logical).
    const box = await page.getByTestId('fab').boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('viewport / fab box not available');
    // RTL: the FAB's left edge should be near the shell's left edge,
    // not its right. Use the shell's bounding box as the reference
    // (on a mobile viewport the shell IS the viewport, so this
    // collapses to a simple left-side check).
    const shell = await page.getByTestId('app-shell').boundingBox();
    if (!shell) throw new Error('shell box not available');
    // FAB sits in the left half of the shell.
    expect(box.x).toBeLessThan(shell.x + shell.width / 2);
  });

  test('long scroll on /list — FAB stays at the same bottom offset', async ({ page }) => {
    await gotoSearch(page);
    await page.goto('/list');
    await expect(page.getByTestId('fab')).toBeVisible();
    // Capture the FAB's screen-space position before and after a
    // forceful scroll. With `absolute` inside the shell + the shell
    // taking the viewport height, the FAB stays pinned to the same
    // viewport y-coordinate even on long catalogues.
    const before = await page.getByTestId('fab').boundingBox();
    await page.mouse.wheel(0, 2000);
    const after = await page.getByTestId('fab').boundingBox();
    if (!before || !after) throw new Error('fab box missing');
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  // v0.9 — duplicate-CTA fix. The Products empty-state already
  // shows a centred "Add your first article" button (testid
  // `empty-zero-cta`); rendering the FAB on top of it produced two
  // visually distinct buttons that did the same thing. The FAB now
  // self-hides on /, /products, /list when the catalogue is empty,
  // and reappears as soon as the merchant creates their first
  // article (or the seed surface inserts one).
  test('hidden on / when catalogue is empty; empty-state CTA is the only add affordance', async ({
    page,
  }) => {
    await gotoSearch(page, 'en', { seedArticle: false });

    // The empty-state lives where the result list would be; its
    // CTA is the centred button the merchant should tap first.
    await expect(page.getByTestId('empty-zero')).toBeVisible();
    await expect(page.getByTestId('empty-zero-cta')).toBeVisible();
    // FAB is gone — no rival add-button.
    await expect(page.getByTestId('fab')).toBeHidden();

    // /products mirrors / (same SearchScreen component, v0.8).
    await page.goto('/products');
    await expect(page.getByTestId('empty-zero')).toBeVisible();
    await expect(page.getByTestId('fab')).toBeHidden();

    // /list redirects to /products — empty state still drives the
    // single-CTA invariant.
    await page.goto('/list');
    await expect(page).toHaveURL(/\/products$/);
    await expect(page.getByTestId('fab')).toBeHidden();

    // Once an article exists the FAB returns. Seed one without a
    // reload-roundtrip — Dexie's liveQuery picks the change up.
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'FAB Shop',
        locale: 'en',
        articles: [{ name: 'First Article', sizes: [{ size: '42', qty: 1 }] }],
        reset: false,
      });
    });
    await expect(page.getByTestId('fab')).toBeVisible();
  });
});
