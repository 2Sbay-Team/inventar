import { expect, test } from '@playwright/test';
import { seedFresh, type SeedFreshOptions } from '../fixtures/seed';

// Stress test — confirm the app handles a realistic-large catalog
// without unacceptable lag. Targets:
//   - 200 articles seeded
//   - search returns top results within 2 seconds end-to-end
//   - dashboard renders within 3 seconds
//
// These budgets are deliberately generous (not microbenchmark tight)
// because shared CI hardware varies. The point is to catch
// pathological regressions like accidental O(n²) scans.
//
// We extend the per-test timeout to 90s — seeding 200 articles via the
// public seed surface (createArticle one at a time) takes ~30s on its
// own. The interactive measurements happen AFTER seed and use their
// own tighter budgets.

test.describe.configure({ timeout: 90_000 });

const COLOURS = ['white', 'black', 'brown', 'blue', 'red', 'beige'];
const SIZES = [
  { size: '38', qty: 2 },
  { size: '39', qty: 3 },
  { size: '40', qty: 4 },
  { size: '41', qty: 3 },
  { size: '42', qty: 2 },
];

function bigCatalogue(n: number): SeedFreshOptions['articles'] {
  const out: NonNullable<SeedFreshOptions['articles']> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      name: `Article ${i.toString().padStart(3, '0')}`,
      colors: [COLOURS[i % COLOURS.length]!],
      brand: `Brand-${i % 7}`,
      category: 'sport',
      cost_tnd: 25_000 + (i % 50) * 1000,
      sale_tnd: 50_000 + (i % 50) * 1500,
      sizes: SIZES,
    });
  }
  return out;
}

test('stress: 200 articles — search returns within budget', async ({ page }) => {
  await seedFresh(page, {
    shopName: 'Stress Shop',
    locale: 'fr',
    articles: bigCatalogue(200),
  });
  await expect(page.getByTestId('search-screen')).toBeVisible();

  const t0 = Date.now();
  await page.getByTestId('search-input').fill('Article 042');
  await expect(page.getByTestId('result-card').first()).toBeVisible({ timeout: 4000 });
  const elapsed = Date.now() - t0;
  // 2s is generous; on dev hw search returns in <300ms typically.
  expect(elapsed, `Search took ${elapsed}ms with 200 articles`).toBeLessThan(2000);
});

test('stress: 200 articles — dashboard renders within budget', async ({ page }) => {
  await seedFresh(page, {
    shopName: 'Stress Shop',
    locale: 'fr',
    articles: bigCatalogue(200),
  });
  await expect(page.getByTestId('search-screen')).toBeVisible();

  const t0 = Date.now();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible({ timeout: 5000 });
  // The big metric tiles are the slowest thing on the page.
  await expect(page.getByTestId('big-revenue')).toBeVisible();
  await expect(page.getByTestId('big-pairs')).toBeVisible();
  const elapsed = Date.now() - t0;
  expect(elapsed, `Dashboard took ${elapsed}ms with 200 articles`).toBeLessThan(3000);
});

test('stress: 200 articles — list screen renders without timeout', async ({ page }) => {
  await seedFresh(page, {
    shopName: 'Stress Shop',
    locale: 'fr',
    articles: bigCatalogue(200),
  });
  await expect(page.getByTestId('search-screen')).toBeVisible();

  await page.getByTestId('nav-list').click();
  await expect(page.getByTestId('list-screen')).toBeVisible({ timeout: 5000 });
  // At least one result-card rendered = list is not stuck on loading state.
  await expect(page.getByTestId('result-card').first()).toBeVisible({ timeout: 5000 });
});
