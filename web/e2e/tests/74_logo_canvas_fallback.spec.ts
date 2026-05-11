import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.5.4 ADR-028 — cross-browser fallback. Strip OffscreenCanvas from
// `window` before app boot to simulate an older iOS Safari WebView
// (14-16.3). The keyer's createKeyingCanvas() factory must transparently
// fall back to HTMLCanvasElement and produce the same keyed PNG.

test.describe('Logo auto-key — HTMLCanvasElement fallback', () => {
  test('without OffscreenCanvas, keying still emits a transparent PNG', async ({ page }) => {
    // Drop OffscreenCanvas before any app code runs so the keyer's
    // canvas factory takes its fallback branch even on Chromium.
    await page.addInitScript(() => {
      // The typeof check inside createKeyingCanvas treats undefined as
      // 'undefined', which is exactly the branch we want to exercise.
      // delete works on globals; assign undefined as a belt-and-braces.
      try {
        delete (window as unknown as Record<string, unknown>).OffscreenCanvas;
      } catch {
        // Some browsers reject delete on non-configurable globals.
      }
      Object.defineProperty(window, 'OffscreenCanvas', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    // Sanity: the init script survives the reload (addInitScript runs
    // on every navigation in the page context).
    const offscreenAvailable = await page.evaluate(() => typeof OffscreenCanvas !== 'undefined');
    expect(offscreenAvailable).toBe(false);

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

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/png');
    // Same keyed-pixel signature as test 67 — the fallback path produces
    // an output indistinguishable from the OffscreenCanvas path.
    expect(info.cornerAlpha).toBe(0);
    expect(info.alphaZero).toBeGreaterThan(info.totalPixels * 0.5);
    expect(info.alphaFull).toBeGreaterThan(0);
  });
});
