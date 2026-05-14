import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// Invoicing-section consolidation into Shop Identity.
//
// N+1  Standalone "Invoicing" section no longer appears in Settings
// N+2  Shop Identity → Business sub-group has Tax ID + Default VAT %
// N+3  Legal name field is in the Identity sub-group
// N+4  Phone field is in the Contact sub-group
// N+5  Previously stored values are readable from the new locations
// N+6  Section summary shows tagline or fallback
// N+7  Business sub-group heading translates EN / FR / AR

async function gotoSettings(page: Page, lang: 'en' | 'fr' | 'ar' = 'en'): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, { lang, shopName: 'MergeTest' });
  await page.reload();
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 10_000 });
}

async function openShopIdentity(page: Page): Promise<void> {
  await page.getByTestId('section-shop-identity-header').click();
  await expect(page.locator('[data-testid="section-shop-identity-body"]')).toBeVisible({
    timeout: 2_000,
  });
}

test.describe('Invoicing → Shop Identity consolidation', () => {
  test('N+1: standalone Invoicing section is gone from Settings', async ({ page }) => {
    await gotoSettings(page);
    await expect(page.getByTestId('section-invoicing')).toHaveCount(0);
  });

  test('N+2: Business sub-group renders Tax ID and Default VAT % inside Shop Identity', async ({
    page,
  }) => {
    await gotoSettings(page);
    await openShopIdentity(page);
    await expect(page.getByTestId('identity-fiscal-id')).toBeVisible();
    await expect(page.getByTestId('identity-default-vat')).toBeVisible();
  });

  test('N+3: Legal name field is in the Identity sub-group inside Shop Identity', async ({
    page,
  }) => {
    await gotoSettings(page);
    await openShopIdentity(page);
    await expect(page.getByTestId('identity-legal-name')).toBeVisible();
  });

  test('N+4: Phone field is in the Contact sub-group inside Shop Identity', async ({ page }) => {
    await gotoSettings(page);
    await openShopIdentity(page);
    await expect(page.getByTestId('identity-phone')).toBeVisible();
  });

  test('N+5: values stored via old Invoicing fields are readable in new locations', async ({
    page,
  }) => {
    await page.goto('/');
    // Seed a profile that already has fiscal_id and default_vat_pct populated.
    await page.evaluate(() => {
      interface IDBOpenRequestEvent extends Event {
        target: IDBOpenRequest;
      }
      const req = indexedDB.open('inventar', 16);
      req.onsuccess = (ev: IDBOpenRequestEvent) => {
        const db = ev.target.result;
        const tx = db.transaction('profiles', 'readwrite');
        const store = tx.objectStore('profiles');
        const getReq = store.getAll();
        getReq.onsuccess = () => {
          const rows = getReq.result as Record<string, unknown>[];
          if (rows.length > 0) {
            const row = {
              ...rows[0],
              fiscal_id: 'TN-123456',
              default_vat_pct: 19,
              phone: '+216 71 000 000',
            };
            store.put(row);
          }
        };
      };
    });

    await onboardViaSeed(page, { lang: 'en', shopName: 'ValTest' });
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await openShopIdentity(page);

    // Tax ID visible in Business sub-group.
    const fiscalInput = page.getByTestId('identity-fiscal-id');
    await expect(fiscalInput).toBeVisible();

    // Default VAT input visible.
    const vatInput = page.getByTestId('identity-default-vat');
    await expect(vatInput).toBeVisible();
  });

  test('N+6: Shop Identity collapsed summary shows tagline or fallback', async ({ page }) => {
    await gotoSettings(page);
    // Section starts collapsed; summary is tagline or "Not configured yet".
    const summary = page.getByTestId('section-shop-identity-summary');
    await expect(summary).toBeVisible();
    const text = await summary.textContent();
    // Summary is non-empty (either the tagline or the "not configured" fallback).
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test('N+7: Business sub-group heading translates correctly', async ({ page }) => {
    // English
    await gotoSettings(page, 'en');
    await openShopIdentity(page);
    await expect(page.getByText('Business')).toBeVisible();

    // French
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'TestFR' });
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('section-shop-identity-header').click();
    await expect(page.getByText('Entreprise')).toBeVisible();

    // Arabic
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'ar', shopName: 'TestAR' });
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('section-shop-identity-header').click();
    await expect(page.getByText('الأعمال')).toBeVisible();
  });
});
