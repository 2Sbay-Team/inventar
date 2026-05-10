import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.1 PhotoPicker refactor: the photo CTA is now a per-block
// dashed dropzone with explicit Camera + Gallery buttons (commit
// 24c1b27). The dropzone lives at `block-${index}-photo-cta` on
// Step 2 of Add Article. This test asserts the structural pieces:
// dashed border, hidden file inputs (camera + gallery), and visible
// action buttons.

test.describe('photo CTA on /add (Step 2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Photo CTA' });
    await page.reload();
    await page.goto('/add');
    // Walk past Step 1 — name is the only required field to enable
    // Continue.
    await page.getByTestId('field-name').fill('Photo Test');
    await page.getByTestId('continue').click();
  });

  test('dashed dropzone + PhotoPicker buttons + hidden inputs render on Step 2', async ({
    page,
  }) => {
    const cta = page.getByTestId('block-0-photo-cta');
    await expect(cta).toBeVisible();
    const borderStyle = await cta.evaluate((el) => getComputedStyle(el).borderStyle);
    expect(borderStyle).toContain('dashed');

    // PhotoPicker exposes two buttons + two hidden file inputs.
    await expect(page.getByTestId('block-0-photo-camera')).toBeVisible();
    await expect(page.getByTestId('block-0-photo-gallery')).toBeVisible();
    // The gallery input keeps the legacy `block-0-photo-input` testid
    // (so existing setInputFiles call sites still work). It's hidden
    // via Tailwind's `hidden` class — playwright's setInputFiles
    // doesn't require it to be visible.
    await expect(page.locator('[data-testid="block-0-photo-input"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="block-0-photo-input-camera"]')).toHaveCount(1);
  });
});
