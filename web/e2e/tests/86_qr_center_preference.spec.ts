import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.6.5 — Settings → Shop profile → QR label branding picker.
// Stores qr_center_mode ('logo' | 'name') on the profile row.
// useQrBranding resolves the choice for every label render site
// (Settings live preview, /settings/label-preview, /article/:id/label),
// with an auto-fallback to 'name' when the merchant deletes the logo
// after picking 'logo'.

async function gotoSettings(page: Page, lang: 'en' | 'fr' | 'ar' = 'en'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'QR Shop' });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('section-shop-profile')).toBeVisible();
}

async function uploadKeyedLogo(page: Page): Promise<void> {
  await page.setInputFiles('[data-testid="shop-logo-input"]', {
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: synthWhiteBgWithSquare(),
  });
  const dialog = page.getByTestId('logo-preview-dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('logo-preview-use-transparent').click();
  await expect(dialog).toBeHidden();
}

async function readQrSvgInnerHtml(page: Page): Promise<string> {
  // ArticleQR mounts an <svg> inside the preview container. The
  // overlay either contains an `<image>` (logo) or a `<text>` (name).
  return page
    .getByTestId('qr-branding-preview-qr')
    .evaluate((el) => (el.querySelector('svg')?.outerHTML ?? '') as string);
}

test.describe('v0.6.5 — Settings QR center preference', () => {
  test('N+1: no logo → only "name" radio shows; preview renders the shop name', async ({
    page,
  }) => {
    await gotoSettings(page);
    // Before any logo is uploaded the merchant has only one option
    // (text). The 'logo' radio is hidden, not just disabled — the
    // brief asked for "hide the option" in this case.
    await expect(page.getByTestId('qr-branding-radio-logo')).toHaveCount(0);
    await expect(page.getByTestId('qr-branding-radio-name')).toBeVisible();
    await expect(page.getByTestId('qr-branding-radio-name')).toBeChecked();
    // Preview contains a <text> element (the styled shop-name fallback).
    const svg = await readQrSvgInnerHtml(page);
    expect(svg).toContain('<text');
    expect(svg).not.toContain('<image');
  });

  test('N+2 + N+3: switching between logo and name flips the preview overlay', async ({ page }) => {
    await gotoSettings(page);
    await uploadKeyedLogo(page);
    // After uploading the keyed PNG, both radios are present, 'logo'
    // is the default (deriveQrCenterMode auto-promotes from 'name' to
    // 'logo' on the merchant's first-logo write).
    await expect(page.getByTestId('qr-branding-radio-logo')).toBeVisible();
    await expect(page.getByTestId('qr-branding-radio-logo')).toBeChecked();
    // Logo preview: <image> inside the SVG.
    await expect.poll(() => readQrSvgInnerHtml(page)).toContain('<image');

    // Switch to name → preview swaps to <text>.
    await page.getByTestId('qr-branding-radio-name').click();
    await expect(page.getByTestId('qr-branding-radio-name')).toBeChecked();
    await expect.poll(() => readQrSvgInnerHtml(page)).toContain('<text');

    // Switch back to logo → preview swaps to <image>.
    await page.getByTestId('qr-branding-radio-logo').click();
    await expect(page.getByTestId('qr-branding-radio-logo')).toBeChecked();
    await expect.poll(() => readQrSvgInnerHtml(page)).toContain('<image');
  });

  test('N+4: deleting the logo flips the preview back to name and hides the logo option', async ({
    page,
  }) => {
    await gotoSettings(page);
    await uploadKeyedLogo(page);
    await expect(page.getByTestId('qr-branding-radio-logo')).toBeChecked();

    // Remove the logo. The picker re-renders: 'logo' option vanishes,
    // 'name' becomes the effective mode (the auto-fallback in
    // QrBrandingPicker), preview switches to <text>.
    await page.getByTestId('shop-logo-remove').click();
    await expect(page.getByTestId('qr-branding-radio-logo')).toHaveCount(0);
    await expect(page.getByTestId('qr-branding-radio-name')).toBeChecked();
    await expect.poll(() => readQrSvgInnerHtml(page)).toContain('<text');
  });

  test('N+5: very long shop name renders an ellipsis-truncated label in the QR centre', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      // Long enough to trip truncateForBranding's 12-char limit.
      shopName: 'Hyper Long Boutique Marrakech',
    });
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    const svg = await readQrSvgInnerHtml(page);
    // truncateForBranding clips at 12 characters and appends "…".
    expect(svg).toMatch(/<text[^>]*>Hyper Long …<\/text>/);
  });

  test('N+6: choice survives a reload', async ({ page }) => {
    await gotoSettings(page);
    await uploadKeyedLogo(page);
    await page.getByTestId('qr-branding-radio-name').click();
    await expect(page.getByTestId('qr-branding-radio-name')).toBeChecked();

    // Reload stays on /settings (the page we navigated to) — wait
    // for the section to remount before re-asserting.
    await page.reload();
    await expect(page.getByTestId('qr-branding')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('qr-branding-radio-name')).toBeChecked();
    await expect(page.getByTestId('qr-branding-radio-logo')).not.toBeChecked();
  });

  test('N+7: section copy translates in FR and AR', async ({ page }) => {
    await gotoSettings(page, 'fr');
    await expect(page.getByTestId('qr-branding')).toContainText('Marque sur étiquette QR');
    await expect(page.getByTestId('qr-branding')).toContainText('Afficher le nom au centre');

    await page.getByTestId('settings-lang-ar').click();
    await expect(page.getByTestId('qr-branding')).toContainText('علامة ملصق QR');
    await expect(page.getByTestId('qr-branding')).toContainText('عرض اسم المتجر في الوسط');
  });
});
