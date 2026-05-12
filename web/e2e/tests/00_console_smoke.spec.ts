import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// Catches runtime errors my other specs might miss because they don't watch
// the console. Walks the four MVP screens, asserts zero console errors and
// zero unhandled exceptions.

test('no console errors during a representative flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  await seedFresh(page, {
    shopName: 'Smoke',
    locale: 'fr',
    articles: standardCatalogue,
  });

  // Search → article → sell → back → list → dashboard → settings
  await page.getByTestId('search-input').fill('white');
  await expect(page.getByTestId('result-card')).toHaveCount(1);
  await page.getByTestId('result-card').first().click();
  await page.getByTestId('size-cell-42').click();
  await page.getByTestId('reason-sale').click();
  await page.getByTestId('adjust-confirm').click();
  await page.getByTestId('detail-back').click();

  // v0.8 — /list redirects to /products (which renders SearchScreen).
  // The pre-v0.8 ListScreen + sort-az interaction is no longer in the
  // catalogue flow; Phase 1 will re-introduce sort chips on the
  // merged Products screen. For now, just confirm the redirect
  // resolves without console noise.
  await page.goto('/list');
  await expect(page.getByTestId('search-screen')).toBeVisible();

  await page.getByTestId('nav-reports').click();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  await page.getByTestId('period-week').click();

  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('settings-lang-ar').click();
  await page.getByTestId('settings-lang-fr').click();

  // Filter out known benign noise we don't control.
  const real = errors.filter(
    (e) =>
      !/Failed to load resource.*sw\.js/i.test(e) && !/workbox/i.test(e) && !/Manifest:/i.test(e),
  );
  expect(real, real.join('\n')).toEqual([]);
});
