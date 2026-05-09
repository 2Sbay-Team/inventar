import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// SPEC §1.4 / §2.2: trilingual search — "white 42", "blanc 42", "أبيض ٤٢"
// must all find the same article. This is the highest-priority correctness
// test for the project; a regression here means search is broken.

test.describe('Search normalisation across FR/AR/EN', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'Naili Shoes',
      locale: 'fr',
      articles: standardCatalogue,
    });
  });

  const cases: ReadonlyArray<{ label: string; query: string; matches: string[] }> = [
    { label: 'EN', query: 'white 42', matches: ['White running shoe'] },
    { label: 'EN-uppercase', query: 'WHITE 42', matches: ['White running shoe'] },
    { label: 'EN-double-space', query: 'white  42', matches: ['White running shoe'] },
    { label: 'FR', query: 'blanc 42', matches: ['White running shoe'] },
    { label: 'AR-eastern-digits', query: 'أبيض ٤٢', matches: ['White running shoe'] },
  ];

  for (const { label, query, matches } of cases) {
    test(`[${label}] "${query}" finds ${matches.join(', ')}`, async ({ page }) => {
      await page.getByTestId('search-input').fill(query);
      // First result should be the expected match, with size 42 surfaced as
      // the in-stock badge (per ranking: in-stock-exact wins).
      const cards = page.getByTestId('result-card');
      await expect(cards.first()).toContainText(matches[0]!);
      const badge = cards.first().getByTestId('stock-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveAttribute('data-variant', 'ok');
      // Count chip should appear once at least one card is rendered.
      await expect(page.getByTestId('search-count')).toBeVisible();
    });
  }

  test('case + whitespace-only differences still produce identical result sets', async ({
    page,
  }) => {
    await page.getByTestId('search-input').fill('white 42');
    const a = await page.getByTestId('result-card').allTextContents();
    await page.getByTestId('search-input').fill('');
    await page.getByTestId('search-input').fill('WHITE  42');
    const b = await page.getByTestId('result-card').allTextContents();
    expect(b).toEqual(a);
  });

  test('an unmatched query renders the empty-match state', async ({ page }) => {
    await page.getByTestId('search-input').fill('purplezzz');
    await expect(page.getByTestId('empty-match')).toBeVisible();
    await expect(page.getByTestId('result-card')).toHaveCount(0);
  });

  test('an empty query lists all candidates', async ({ page }) => {
    // Default load already shows all; explicit clear keeps it that way.
    await expect(page.getByTestId('result-card')).toHaveCount(standardCatalogue.length);
  });
});
