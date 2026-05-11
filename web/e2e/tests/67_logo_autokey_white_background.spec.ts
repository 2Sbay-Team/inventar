import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.5.4 ADR-026 — happy path. A pure-white-background logo with a
// colored center square should trip the auto-key threshold gate, open
// the preview dialog, and (after the merchant confirms) end up stored
// as a PNG whose corner pixels are fully transparent.

test.describe('Logo auto-key — pure white background', () => {
  test('keys to transparent PNG and persists alpha-channel pixels', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();

    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthWhiteBgWithSquare(),
    });

    const dialog = page.getByTestId('logo-preview-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('logo-preview-original')).toBeVisible();
    await expect(page.getByTestId('logo-preview-transparent')).toBeVisible();

    await page.getByTestId('logo-preview-use-transparent').click();
    await expect(dialog).toBeHidden();

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/png');
    // Pure-white corners should have keyed to fully transparent.
    expect(info.cornerAlpha).toBe(0);
    // A meaningful fraction of the image was the white bg; expect most
    // of those pixels to now be transparent.
    expect(info.alphaZero).toBeGreaterThan(info.totalPixels * 0.5);
    // The center colored square should remain opaque.
    expect(info.alphaFull).toBeGreaterThan(0);
  });
});
