import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthOffWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.5.4 ADR-026 — off-white #F5F5F5 background should still trip the
// keyer (luminance ≈ 0.96, saturation 0). The hard pixel edge between
// the colored square and the bg is smeared by JPEG re-encoding into
// mid-grey transition pixels, some of which the keyer's [25, 35) RGB-
// distance band assigns alpha=128. Result: the keyed PNG has not just
// transparent + opaque pixels but a non-trivial number of partial-alpha
// pixels, proving the antialias smoothing kicked in.

test.describe('Logo auto-key — off-white background', () => {
  test('off-white keys to transparent with anti-aliased edge band', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();

    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthOffWhiteBgWithSquare(),
    });

    const dialog = page.getByTestId('logo-preview-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('logo-preview-use-transparent').click();
    await expect(dialog).toBeHidden();

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/png');
    // Most of the image was the off-white bg → most pixels keyed.
    expect(info.alphaZero).toBeGreaterThan(info.totalPixels * 0.5);
    // The square's interior remains opaque.
    expect(info.alphaFull).toBeGreaterThan(0);
    // The keying-boundary band must have produced at least some
    // partial-alpha pixels — that's the halo-prevention mechanism
    // working. Without it we'd see only 0 / 255 alpha values.
    expect(info.alphaPartial).toBeGreaterThan(0);
  });
});
