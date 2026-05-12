import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.9 Phase 8 — completion ring + business-card 30 % gate.
// Pure logic is unit-tested in profile-completion.test.ts; this
// spec pins that the same numbers light up the right chrome in
// the live DOM:
//
//   * fresh profile → ring at 0 %, business card teaser visible.
//   * filling four fields crosses the 30 % threshold → teaser
//     disappears, business card surface + share + copy buttons
//     visible.

async function gotoSettings(page: Page): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang: 'en', shopName: 'Completion Test Shop' });
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('section-shop-identity')).toBeVisible({ timeout: 10_000 });
}

// Reads the percentage rendered inside the completion ring SVG.
// The percentage text sits under the testid `completion-ring-percent`.
async function readPercentage(page: Page): Promise<number> {
  const text = await page.getByTestId('completion-ring-percent').textContent();
  if (text === null) throw new Error('completion ring text missing');
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  if (!Number.isFinite(n)) throw new Error(`unparseable percent ${text}`);
  return n;
}

test.describe('v0.9 Phase 8 — completion + business-card gate', () => {
  test('empty profile: ring at 0 % and teaser shown', async ({ page }) => {
    await gotoSettings(page);
    const pct = await readPercentage(page);
    expect(pct).toBe(0);
    await expect(page.getByTestId('business-card-teaser')).toBeVisible();
    await expect(page.getByTestId('business-card-surface')).toHaveCount(0);
  });

  test('filling four fields crosses 30 % → teaser disappears, card surface appears', async ({
    page,
  }) => {
    await gotoSettings(page);
    // Pick four fields that exist in the merchant's Settings:
    // tagline + description + phone (whatsapp counts independently)
    // + city. That's 4 of 12 = 33 % which clears the 30 % gate.
    await page.getByTestId('identity-tagline').fill('Quality fashion since 2020');
    await page.getByTestId('identity-description').fill('Specialty boutique for men and women.');
    await page.getByTestId('identity-whatsapp').fill('+216 98 765 432');
    await page.getByTestId('identity-address-city').fill('Tunis');
    // Give the autosave debouncer + completion recompute a beat to
    // settle. 1.5 s is comfortably past 800 ms + render.
    await page.waitForTimeout(1_500);

    const pct = await readPercentage(page);
    expect(pct).toBeGreaterThanOrEqual(30);

    await expect(page.getByTestId('business-card-teaser')).toHaveCount(0);
    await expect(page.getByTestId('business-card-surface')).toBeVisible();
    await expect(page.getByTestId('business-card-share')).toBeVisible();
    await expect(page.getByTestId('business-card-copy')).toBeVisible();
  });

  test('completion hint copy reflects the next milestone', async ({ page }) => {
    await gotoSettings(page);
    // At 0 % the next milestone is receipts (30 %). The hint text
    // is locale-aware; under English it includes "30%".
    await expect(page.getByTestId('completion-hint')).toContainText('30%');
    // The milestone name (translated) is also present.
    await expect(page.getByTestId('completion-hint')).toContainText(/receipts/i);
  });
});
