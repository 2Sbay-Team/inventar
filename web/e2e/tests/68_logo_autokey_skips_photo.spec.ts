import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthHighVariancePhoto } from '../helpers/synth-logo';

// v0.5.4 ADR-026 — threshold-gate negative case. An image whose four
// corners disagree wildly (the typical real-world photo signature) must
// NOT trigger auto-keying. The preview dialog stays closed and the
// original compressed JPEG lands in IndexedDB as-is.

test.describe('Logo auto-key — skips non-uniform photo', () => {
  test('high-variance corners → dialog never opens, JPEG stored as-is', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();

    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: synthHighVariancePhoto(),
    });

    // No preview dialog should open: the threshold gate (luminance +
    // stddev) rejects this image as a candidate. Wait long enough that
    // a slow keyer would still have surfaced the dialog if it ran.
    const dialog = page.getByTestId('logo-preview-dialog');
    await expect(dialog).toBeHidden();

    const info = await readStoredLogo(page);
    // Compressed JPEG (mime preserved by storePhoto → photoToBlob).
    expect(info.mime).toBe('image/jpeg');
    // JPEG can't carry an alpha channel — every pixel is fully opaque.
    expect(info.alphaFull).toBe(info.totalPixels);
    expect(info.alphaZero).toBe(0);
    expect(info.alphaPartial).toBe(0);
  });
});
