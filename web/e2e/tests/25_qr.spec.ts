import { expect, test } from '@playwright/test';
import { seedFresh, standardCatalogue } from '../fixtures/seed';

// Verifies the QR display dialog opens on article-detail and the scan
// button is wired on add-article. Doesn't assert the scanned VALUE
// (Playwright can't easily mock getUserMedia + BarcodeDetector); only
// the presence + open behaviour of the UI affordances.

test.describe('QR display + scan', () => {
  test.beforeEach(async ({ page }) => {
    await seedFresh(page, {
      shopName: 'QR Test',
      locale: 'en',
      articles: standardCatalogue,
    });
  });

  test('article-detail QR icon opens a dialog with a QR image', async ({ page }) => {
    await page.getByTestId('search-input').fill('white');
    await page.getByTestId('result-card').first().click();
    await page.getByTestId('detail-qr').click();

    const dialog = page.getByTestId('article-qr-dialog');
    await expect(dialog).toBeVisible();
    // The QR is rendered as an inline SVG via dangerouslySetInnerHTML;
    // we assert the SVG element appears under the article-qr container.
    const svg = page.getByTestId('article-qr').locator('svg');
    await expect(svg).toBeVisible({ timeout: 4000 });
  });

  test('add-article scan button opens the scanner sheet', async ({ page }) => {
    await page.getByTestId('nav-add').click();
    await page.getByTestId('add-scan').click();
    // The scanner mounts even when BarcodeDetector / camera aren't
    // available in headless chromium — it just shows the unsupported
    // card OR the camera-error card. Either way the sheet itself is
    // visible.
    await expect(page.getByTestId('barcode-scanner')).toBeVisible();
    // Close button is wired so the user can back out.
    await page.getByTestId('barcode-scanner-close').click();
    await expect(page.getByTestId('barcode-scanner')).toHaveCount(0);
  });
});
