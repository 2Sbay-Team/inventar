import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';
import { onboardViaSeed } from '../helpers/onboarding';

// QR renderer consistency audit.
//
// N+1  All QR-rendering locations in the codebase use the same modern path
//      (verified via data-generator="modern" attribute when flag is ON)
// N+2  "Show QR code" dialog uses the modern rounded renderer
// N+3  "Show QR code" dialog shows a center branding element (logo or name)
// N+4  All QR screens share the same renderer type (flag-consistent)
// N+5  QR from the "Show QR code" dialog decodes correctly via jsQR

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSQR_BUNDLE = path.resolve(__dirname, '../../node_modules/jsqr/dist/jsQR.js');

interface JsqrResult {
  data: string;
}

async function decodeQr(page: Page, testId: string): Promise<string | null> {
  await page.addScriptTag({ path: JSQR_BUNDLE });
  return page.evaluate(async (tid) => {
    const wrapper = document.querySelector(`[data-testid="${tid}"]`);
    const svg = wrapper?.querySelector('svg');
    if (!svg) throw new Error(`No SVG inside [data-testid="${tid}"]`);
    const serialized = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('svg → image load failed'));
        img.src = url;
      });
      const SIZE = 512;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imgData = ctx.getImageData(0, 0, SIZE, SIZE);
      const jsQR = (
        window as unknown as {
          jsQR: (d: Uint8ClampedArray, w: number, h: number) => JsqrResult | null;
        }
      ).jsQR;
      const result = jsQR(imgData.data, imgData.width, imgData.height);
      return result ? result.data : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, testId);
}

// Onboard + enable the modern flag + navigate to article detail QR dialog.
async function openArticleQrDialog(page: Page): Promise<string> {
  await seedFresh(page, {
    shopName: 'QRConsistency',
    locale: 'en',
    articles: standardCatalogue,
  });
  await page.evaluate(() => localStorage.setItem('ff_modern_qr_style', 'true'));
  await page.reload();

  await page.getByTestId('search-input').fill('white');
  await page.getByTestId('result-card').first().click();

  // Wait for article detail to load, then open the QR dialog.
  await expect(page.getByTestId('detail-qr')).toBeVisible();
  await page.getByTestId('detail-qr').click();
  await expect(page.getByTestId('article-qr-dialog')).toBeVisible();
  await expect(page.locator('[data-testid="article-qr"] svg')).toBeVisible({ timeout: 5_000 });

  // Return the article id so the test can assert the decoded URL.
  return page.evaluate(() => {
    const m = window.location.pathname.match(/\/article\/([^/]+)/);
    return m?.[1] ?? '';
  });
}

test.describe('QR renderer consistency', () => {
  test('N+1: audit — all QR locations carry data-generator="modern" when flag is ON', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'AuditShop' });
    await page.evaluate(() => localStorage.setItem('ff_modern_qr_style', 'true'));
    await page.reload();

    // Settings QR branding preview
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('section-shop-profile-header').click();
    await expect(page.locator('[data-testid="qr-branding-preview-qr"]')).toBeVisible({
      timeout: 5_000,
    });
    const settingsGenerator = await page.evaluate(() =>
      document
        .querySelector('[data-testid="qr-branding-preview-qr"]')
        ?.getAttribute('data-generator'),
    );
    expect(settingsGenerator).toBe('modern');

    // Label preview
    await page.getByTestId('settings-label-preview').click();
    await expect(page.locator('[data-testid="label-qr"] svg')).toBeVisible({ timeout: 5_000 });
    const labelGenerator = await page.evaluate(() =>
      document.querySelector('[data-testid="label-qr"]')?.getAttribute('data-generator'),
    );
    expect(labelGenerator).toBe('modern');
  });

  test('N+2: "Show QR code" dialog uses modern rounded renderer (data-generator="modern")', async ({
    page,
  }) => {
    await openArticleQrDialog(page);

    const generator = await page.evaluate(() =>
      document.querySelector('[data-testid="article-qr"]')?.getAttribute('data-generator'),
    );
    expect(generator).toBe('modern');
  });

  test('N+3: "Show QR code" dialog shows a center branding element', async ({ page }) => {
    await openArticleQrDialog(page);

    // With the store-name branding mode (default — no logo uploaded),
    // useQrBranding returns { text: 'QRConsistency' }. ModernQRCode
    // converts this to a data URL and passes it as the center image,
    // which qr-code-styling renders as an <image> element.
    const hasCenterImage = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="article-qr"] svg');
      return !!svg?.querySelector('image');
    });
    expect(hasCenterImage).toBe(true);
  });

  test('N+4: label preview and QR dialog both use the same renderer type', async ({ page }) => {
    await openArticleQrDialog(page);

    // Open label preview in a new page navigation to check it too.
    const dialogGenerator = await page.evaluate(() =>
      document.querySelector('[data-testid="article-qr"]')?.getAttribute('data-generator'),
    );

    // Close dialog and navigate to settings → label preview.
    await page.keyboard.press('Escape');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('section-shop-profile-header').click();
    await page.getByTestId('settings-label-preview').click();
    await expect(page.locator('[data-testid="label-qr"] svg')).toBeVisible({ timeout: 5_000 });
    const labelGenerator = await page.evaluate(() =>
      document.querySelector('[data-testid="label-qr"]')?.getAttribute('data-generator'),
    );

    expect(dialogGenerator).toBe('modern');
    expect(labelGenerator).toBe('modern');
    expect(dialogGenerator).toBe(labelGenerator);
  });

  test('N+5: "Show QR code" dialog QR decodes to the correct article URL', async ({ page }) => {
    const articleId = await openArticleQrDialog(page);
    expect(articleId).toBeTruthy();

    const decoded = await decodeQr(page, 'article-qr');
    expect(decoded).toBe(`https://inventar.hoodhood.ai/article/${articleId}`);
  });
});
