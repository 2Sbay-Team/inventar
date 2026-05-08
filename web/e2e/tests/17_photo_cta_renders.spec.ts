import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// Mockup §3 — the photo CTA is the first thing the user sees on /add.
// It must render: a dashed-border container, a camera SVG icon, the
// localised "tap to take photo" label, and the "required" tag.

test.describe('photo CTA on /add', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Photo CTA' });
    await page.reload();
    await page.getByTestId('nav-add').click();
  });

  test('renders the dashed container, camera SVG, label, and required tag', async ({ page }) => {
    const cta = page.getByTestId('photo-cta');
    await expect(cta).toBeVisible();

    // Dashed border is set via Tailwind's border-dashed.
    const borderStyle = await cta.evaluate((el) => getComputedStyle(el).borderStyle);
    expect(borderStyle).toContain('dashed');

    // Camera SVG icon is in the DOM.
    await expect(page.getByTestId('photo-cta-icon')).toBeVisible();
    const svgCount = await cta.locator('svg').count();
    expect(svgCount).toBeGreaterThanOrEqual(1);

    // Localised label and "required" tag (fr).
    await expect(cta).toContainText('Appuyez pour prendre une photo');
    await expect(cta).toContainText('obligatoire');
  });
});
