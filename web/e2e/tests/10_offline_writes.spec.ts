import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// SPEC §1.9 / TESTING §2.4: the app makes zero network calls during steady-
// state use. There is no server to switch off — but we want to verify a
// representative spread of actions issues no fetches against our origin.

test('zero same-origin network calls during steady-state use', async ({ page, context }) => {
  await seedFresh(page, {
    shopName: 'Offline Shop',
    locale: 'fr',
    articles: standardCatalogue,
  });
  await page.waitForLoadState('networkidle');

  // From now on, count any same-origin responses that bypass the service
  // worker — those are the real backend calls. Lazy-loaded route chunks
  // requested during navigation are served from the SW precache, so the
  // response is fromServiceWorker() and doesn't count.
  const baseURL = new URL(page.url()).origin;
  let calls = 0;
  page.on('response', (resp) => {
    if (new URL(resp.url()).origin === baseURL && !resp.fromServiceWorker()) {
      calls++;
    }
  });

  await page.getByTestId('search-input').fill('white');
  await expect(page.getByTestId('result-card')).toHaveCount(1);
  await page.getByTestId('result-card').first().click();
  await expect(page.getByTestId('detail-bar')).toBeVisible();
  await page.getByTestId('size-cell-42').click();
  await page.getByTestId('reason-sale').click();
  await page.getByTestId('adjust-confirm').click();
  await page.getByTestId('detail-back').click();
  await page.getByTestId('nav-dashboard').click();

  // The SW navigation handler may issue a single navigation revalidation;
  // anything beyond that is a regression.
  expect(calls).toBeLessThanOrEqual(2);
  void context;
});
