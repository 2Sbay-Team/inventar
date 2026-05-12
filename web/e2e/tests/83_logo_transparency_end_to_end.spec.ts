import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import { readStoredLogo } from '../helpers/logo-assertions';
import { synthHighVariancePhoto, synthWhiteBgWithSquare } from '../helpers/synth-logo';

// v0.6.3 ADR-028 follow-up — the user-listed verification matrix for
// the v0.5.4 logo auto-key feature. The save pipeline correctly stores
// the keyed PNG (test 70) and the existing render sites use the
// `transparent` PhotoThumb prop (test 81); this spec re-asserts the
// contract end-to-end so the diagnosis points in the bug report
// (MIME, render backdrop, variable swap, backup round-trip) are each
// covered by their own focused expectation.
//
// Layout mirrors the bug-report numbering N+1..N+5:
//   • N+1 — stored blob MIME is image/png after "Use transparent".
//   • N+2 — header shows no visible white/light box around the logo.
//   • N+3 — failed auto-key keeps the original JPEG (variable-swap
//     check: the kept blob really is the kept-original branch, not
//     the keyed PNG).
//   • N+4 — backup export embeds a base64 PNG and import restores
//     the same image/png mime on a fresh install.
//   • N+5 — every screen where the logo renders computes a
//     background-color of rgba(0, 0, 0, 0) on the logo container.

const TRANSPARENT_RGBA = 'rgba(0, 0, 0, 0)';

async function backgroundColor(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => window.getComputedStyle(el).backgroundColor);
}

async function uploadAndKeyLogo(page: Page): Promise<void> {
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
}

test.describe('v0.6.3 — logo transparency end-to-end matrix (N+1..N+5)', () => {
  test('N+1: "Use transparent" stores blob with MIME image/png, not image/jpeg', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    await uploadAndKeyLogo(page);

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/png');
    expect(info.cornerAlpha).toBe(0);
    expect(info.alphaZero).toBeGreaterThan(info.totalPixels * 0.5);
  });

  test('N+2: transparent logo renders in the header with no white/light box', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Boutique' });
    await page.reload();

    await uploadAndKeyLogo(page);

    // Land on a screen that mounts ShopHeader (Search tab).
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await expect(page.locator('[data-testid="shop-logo"] img')).toBeVisible({ timeout: 5_000 });
    expect(await backgroundColor(page, 'shop-logo')).toBe(TRANSPARENT_RGBA);
  });

  test('N+3: failed auto-key keeps the original JPEG (variable-swap regression guard)', async ({
    page,
  }) => {
    // The high-variance synthetic photo trips the keyer's threshold
    // gate (non-uniform corners) — the util returns 'skipped' and the
    // save path commits the compressed JPEG. If the wrong variable
    // were stored (e.g. an empty keyed PNG), MIME or alpha would
    // disagree with this expectation.
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Photo Shop' });
    await page.reload();

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    await page.setInputFiles('[data-testid="shop-logo-input"]', {
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: synthHighVariancePhoto(),
    });
    // No dialog because the keyer skipped — wait on the preview
    // <img> mounting instead.
    await expect(page.locator('[data-testid="shop-logo-preview"] img')).toBeVisible({
      timeout: 10_000,
    });

    const info = await readStoredLogo(page);
    expect(info.mime).toBe('image/jpeg');
    expect(info.alphaFull).toBe(info.totalPixels);
    expect(info.alphaZero).toBe(0);
  });

  test('N+4: backup round-trip preserves image/png mime and the keyed bytes', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Backup Shop' });
    await page.reload();

    await uploadAndKeyLogo(page);

    // Export, then inspect the JSON before importing. Photos serialise
    // their bytes to base64 alongside the `mime` field — both must
    // round-trip cleanly for the rendered logo to stay transparent.
    const exportedJson = await page.evaluate(() => window.__inventarSeed!.exportJson());
    const parsed = JSON.parse(exportedJson) as {
      rows: { photos: Array<{ mime: string; blob_b64: string }> };
    };
    expect(parsed.rows.photos.length).toBe(1);
    const logoPhoto = parsed.rows.photos[0]!;
    expect(logoPhoto.mime).toBe('image/png');
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A. Verify the first 8 bytes
    // of the decoded base64 match — proves the bytes really are a PNG,
    // not (e.g.) a JPEG mis-labelled with image/png.
    const firstBytes = Buffer.from(logoPhoto.blob_b64, 'base64').subarray(0, 8);
    expect(Array.from(firstBytes)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Reset the DB and re-import via the Settings → Import path. After
    // import, the rendered logo must still report image/png and still
    // sit on a transparent container (no cream box re-introduced).
    await page.evaluate(() => window.__inventarSeed!.reset());
    await page.goto('/');
    await expect(page.getByTestId('step-language')).toBeVisible();
    await page.getByTestId('lang-en').click();
    await expect(page.getByTestId('step-intent')).toBeVisible();
    await page.getByTestId('intent-import-input').setInputFiles({
      name: 'inventar-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(exportedJson),
    });
    await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-profile')).toBeVisible();
    const restored = await readStoredLogo(page);
    expect(restored.mime).toBe('image/png');
    expect(restored.cornerAlpha).toBe(0);
  });

  test('N+5: every screen rendering the logo computes background-color rgba(0, 0, 0, 0)', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Audit Shop' });
    await page.reload();

    await uploadAndKeyLogo(page);

    // Settings preview (already mounted from uploadAndKeyLogo).
    await expect(page.locator('[data-testid="shop-logo-preview"] img')).toBeVisible({
      timeout: 5_000,
    });
    expect(await backgroundColor(page, 'shop-logo-preview')).toBe(TRANSPARENT_RGBA);

    // Header on Search.
    await page.getByTestId('nav-search').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    await expect(page.locator('[data-testid="shop-logo"] img')).toBeVisible({ timeout: 5_000 });
    expect(await backgroundColor(page, 'shop-logo')).toBe(TRANSPARENT_RGBA);

    // Header on Dashboard.
    await page.getByTestId('nav-dashboard').click();
    await expect(page.getByTestId('dashboard-screen')).toBeVisible();
    await expect(page.locator('[data-testid="shop-logo"] img')).toBeVisible({ timeout: 5_000 });
    expect(await backgroundColor(page, 'shop-logo')).toBe(TRANSPARENT_RGBA);
  });
});
