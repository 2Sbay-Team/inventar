import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.6.2 — the v0.5.4 ADR-028 keyer correctly produces a transparent
// PNG (verified by test 70 against the stored alpha channel), but
// the PhotoThumb container used to wrap every render site with a
// `bg-paper-deep` backdrop + `border-hair border`. The cream backdrop
// showed through the transparent PNG, producing the "white/light
// box" merchants reported after picking "Use transparent".
//
// PhotoThumb now accepts `transparent` and the two logo callers
// (shop-header, Settings shop-logo-preview) pass it. These specs
// pin the contract: where a logo renders, the wrapping element's
// computed background-color is fully transparent — no cream box.

async function backgroundColor(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

const TRANSPARENT_RGBA = 'rgba(0, 0, 0, 0)';

test.describe('v0.6.2 — logo renders without a visible backdrop', () => {
  test('Settings preview + header: keyed transparent logo sits on transparent containers', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    // Drive the v0.5.4 keyer flow end-to-end so the test exercises
    // the real save path, not a pre-seeded photo row.
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthWhiteBgWithSquare(),
    });
    const dialog = page.getByTestId('logo-preview-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('logo-preview-use-transparent').click();
    await expect(dialog).toBeHidden();

    // Settings preview: with a logo present, the PhotoThumb drops
    // its bg-paper-deep + border so the cream doesn't bleed through.
    await expect(page.locator('[data-testid="shop-logo-preview"] img')).toBeVisible({
      timeout: 5_000,
    });
    expect(await backgroundColor(page, 'shop-logo-preview')).toBe(TRANSPARENT_RGBA);

    // Navigate to a screen that mounts the shop-header (search).
    await page.getByTestId('nav-products').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await expect(page.locator('[data-testid="shop-logo"] img')).toBeVisible({ timeout: 5_000 });
    expect(await backgroundColor(page, 'shop-logo')).toBe(TRANSPARENT_RGBA);
  });

  test('Settings empty-state placeholder still has the cream backdrop (no regression on no-logo case)', async ({
    page,
  }) => {
    // Without a logo configured the PhotoThumb keeps its bg-paper-deep
    // so the empty-state ImageIcon stays visible against the white
    // Settings card. transparent=true on a missing logo would render
    // an invisible icon on a white card.
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'No Logo Shop' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    const bg = await backgroundColor(page, 'shop-logo-preview');
    // bg-paper-deep is #FCEFE2 (the cream-deep theme token).
    expect(bg).toBe('rgb(252, 239, 226)');
  });

  test('Keep-original path also renders without a cream box (transparent variant covers JPEG too)', async ({
    page,
  }) => {
    // The transparent prop on the Settings PhotoThumb is gated only
    // on whether a logo is set, not on its MIME — a merchant who
    // picked "Keep original" has a JPEG logo with its own (opaque)
    // background, and we still drop the surrounding box so the
    // visible chrome stays consistent across choices.
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Keep Original Shop' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthWhiteBgWithSquare(),
    });
    await expect(page.getByTestId('logo-preview-dialog')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('logo-preview-keep-original').click();
    await expect(page.getByTestId('logo-preview-dialog')).toBeHidden();

    await expect(page.locator('[data-testid="shop-logo-preview"] img')).toBeVisible({
      timeout: 5_000,
    });
    expect(await backgroundColor(page, 'shop-logo-preview')).toBe(TRANSPARENT_RGBA);
  });
});
