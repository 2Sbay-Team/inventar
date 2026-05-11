import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.5.4 ADR-026 — merchant-override case. The keyer correctly proposes
// a transparent candidate, but the merchant picks "Keep original" — we
// must persist the unmodified compressed JPEG, not the keyed PNG.

test.describe('Logo auto-key — keep original', () => {
  test('keep-original button stores the JPEG without transparency', async ({ page }) => {
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

    await page.getByTestId('logo-preview-keep-original').click();
    await expect(dialog).toBeHidden();

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/jpeg');
    // Original JPEG → no transparency anywhere.
    expect(info.alphaFull).toBe(info.totalPixels);
    expect(info.alphaZero).toBe(0);
  });
});
