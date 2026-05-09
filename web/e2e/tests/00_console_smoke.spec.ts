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

  await page.getByTestId('nav-list').click();
  await expect(page.getByTestId('list-screen')).toBeVisible();
  await page.getByTestId('sort-az').click();

  await page.getByTestId('nav-dashboard').click();
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
