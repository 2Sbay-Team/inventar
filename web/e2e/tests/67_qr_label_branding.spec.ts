import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.6 ADR-027 — printed QR labels carry centered branding (logo or
// store name). These specs prove two things end-to-end:
//   1. The branded QR still scans correctly under jsQR despite the
//      ~5 % occluded center area (level Q error correction handles it).
//   2. The branding-layer rendering chooses logo when available and
//      falls back to the store name otherwise.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSQR_BUNDLE = path.resolve(__dirname, '../../node_modules/jsqr/dist/jsQR.js');
const SAMPLE_PHOTO = path.resolve(__dirname, '../fixtures/photos/sample.png');

interface JsqrResult {
  data: string;
  width: number;
  height: number;
}

// Loads jsQR into the page, rasterizes the rendered label QR <svg> to
// a canvas, and decodes it. Returns the recovered string or `null`
// if jsQR couldn't find a QR pattern.
async function decodeLabelQR(page: Page): Promise<string | null> {
  await page.addScriptTag({ path: JSQR_BUNDLE });
  return page.evaluate(async () => {
    const wrapper = document.querySelector('[data-testid="label-qr"]');
    const svg = wrapper?.querySelector('svg');
    if (!svg) throw new Error('label-qr svg not yet rendered');
    // Serialize the live SVG (post-branding overlay) and rasterize it
    // through an <img>+canvas pipeline — same path a browser print
    // engine takes when it lays out an SVG inside a PDF.
    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('svg → image failed to load'));
        img.src = url;
      });
      // Render at 512×512 — comfortably above the ~33-module QR's
      // native resolution so each module spans ~15 px and jsQR has
      // plenty of pixels to lock onto.
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context unavailable');
      // Force a white background — some browsers rasterize SVG with a
      // transparent backdrop, and the QR's quiet zone relies on white.
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size);
      const jsQR = (
        window as unknown as {
          jsQR: (d: Uint8ClampedArray, w: number, h: number) => JsqrResult | null;
        }
      ).jsQR;
      const result = jsQR(data.data, data.width, data.height);
      return result ? result.data : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

test.describe('QR label center branding', () => {
  test('store name fallback: QR scans via jsQR and SVG contains a <text> overlay', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Boutique',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();

    // Create one article via the UI so we have a deterministic id to
    // pin the scan-result URL to.
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await page.getByTestId('field-name').fill('Air Max');
    await page.getByTestId('field-cost').fill('5000');
    await page.getByTestId('field-sale').fill('15000');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE_PHOTO);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('M');
    await page.getByTestId('block-0-size-0-floor').fill('3');
    await page.getByTestId('save').click();

    // Add Article lands the merchant on the printable-label screen.
    await expect(page.getByTestId('label-screen')).toBeVisible();
    await expect(page.locator('[data-testid="label-qr"] svg')).toBeVisible();

    const articleId = await page.evaluate(() => {
      const m = window.location.pathname.match(/\/article\/([^/]+)\/label/);
      return m?.[1] ?? null;
    });
    expect(articleId).not.toBeNull();

    const decoded = await decodeLabelQR(page);
    expect(decoded).toBe(`https://inventar.hoodhood.ai/article/${articleId}`);

    // Branding overlay: the no-logo branch must inject a <text>
    // element carrying the store name.
    const overlay = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="label-qr"] svg');
      return {
        hasText: !!svg?.querySelector('text'),
        hasImage: !!svg?.querySelector('image'),
        text: svg?.querySelector('text')?.textContent ?? null,
      };
    });
    expect(overlay.hasText).toBe(true);
    expect(overlay.hasImage).toBe(false);
    expect(overlay.text).toBe('Boutique');
  });

  test('logo overlay: uploaded logo lands as <image> and QR still scans', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Royal Babouche',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();

    // Upload a logo via Settings. The synthesized PNG is plain white
    // (no transparency) so the branding helper takes the logo branch
    // without the v0.5.4 keying preview interfering (keying is on a
    // separate branch and not on main).
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthWhiteBgWithSquare(),
    });
    await expect(page.locator('[data-testid="shop-logo-preview"] img')).toBeVisible({
      timeout: 10_000,
    });

    // Create an article so we can land on /article/:id/label.
    await page.goto('/add');
    await page.getByTestId('field-name').fill('Slipper');
    await page.getByTestId('field-cost').fill('3000');
    await page.getByTestId('field-sale').fill('8000');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE_PHOTO);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('M');
    await page.getByTestId('block-0-size-0-floor').fill('3');
    await page.getByTestId('save').click();
    await expect(page.getByTestId('label-screen')).toBeVisible();
    await expect(page.locator('[data-testid="label-qr"] svg')).toBeVisible();

    const articleId = await page.evaluate(() => {
      const m = window.location.pathname.match(/\/article\/([^/]+)\/label/);
      return m?.[1] ?? null;
    });
    expect(articleId).not.toBeNull();

    // Wait until the async logo data URL has been resolved and the
    // overlay <image> is present — useLogoDataUrl is async so the
    // first render may show the plain QR.
    await expect(page.locator('[data-testid="label-qr"] svg image')).toBeVisible({
      timeout: 5_000,
    });

    const decoded = await decodeLabelQR(page);
    expect(decoded).toBe(`https://inventar.hoodhood.ai/article/${articleId}`);

    const overlay = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="label-qr"] svg');
      return {
        hasText: !!svg?.querySelector('text'),
        hasImage: !!svg?.querySelector('image'),
        imageHref:
          svg?.querySelector('image')?.getAttribute('href') ??
          svg?.querySelector('image')?.getAttribute('xlink:href') ??
          null,
      };
    });
    expect(overlay.hasImage).toBe(true);
    expect(overlay.hasText).toBe(false);
    expect(overlay.imageHref).toMatch(/^data:image\/[a-z]+;base64,/);
  });

  test('Settings → Preview label renders the stub label with branding', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Hood Hood',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-label-preview').click();
    await expect(page.getByTestId('label-preview-screen')).toBeVisible();
    await expect(page.locator('[data-testid="label-qr"] svg')).toBeVisible();

    const decoded = await decodeLabelQR(page);
    // The stub label hardcodes a placeholder id so the merchant can
    // see the layout without picking an article.
    expect(decoded).toBe('https://inventar.hoodhood.ai/article/SAMPLE-PREVIEW');
    const overlayText = await page.evaluate(
      () => document.querySelector('[data-testid="label-qr"] svg text')?.textContent ?? null,
    );
    expect(overlayText).toBe('Hood Hood');
  });
});
