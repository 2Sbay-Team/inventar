import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.9 ADR-041 — per-article tax category. Brief acceptance:
//   N+1: "View past invoices" no longer appears in Settings.
//   N+6: Tax field hidden in Add Article when no shop default VAT.
//   N+8: Tax field labels translated EN / FR / AR.
//
// The behavioural unit tests for the resolver (N+2…N+5, N+7) live
// in src/utils/tax-rate.test.ts; this spec pins the UI surface only.

async function bootstrap(
  page: Page,
  options: {
    lang: 'en' | 'fr' | 'ar';
    defaultVatPct?: number | null;
  },
): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: options.lang,
    shopName: 'Tax Test Shop',
    storeType: 'shop',
    shopSubtypes: ['food_beverages'],
  });
  // Set the merchant's default VAT directly via the seed surface
  // (Settings → Invoicing is exercised in 64_sell_invoice_facture).
  if (options.defaultVatPct !== undefined) {
    await page.evaluate(async (pct) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('profile', 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        const store = tx.objectStore('profile');
        const getReq = store.get('singleton');
        getReq.onsuccess = () => {
          const profile = getReq.result;
          if (!profile) {
            reject(new Error('profile singleton missing'));
            return;
          }
          profile.default_vat_pct = pct;
          store.put(profile);
        };
      });
      idb.close();
    }, options.defaultVatPct);
  }
  await page.reload();
}

test.describe('v0.9 ADR-041 — per-article tax category UI', () => {
  test('N+1: "View past invoices" link is gone from Settings → Invoicing', async ({ page }) => {
    await bootstrap(page, { lang: 'en' });
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 10_000 });
    // The Invoicing section still renders (legal name, address,
    // fiscal ID, default VAT) but its old "View past invoices"
    // link was lifted out. The /invoices route still resolves direct
    // links — that's covered by 64_sell_invoice_facture.spec.ts and
    // 87_invoice_back_button.spec.ts.
    await expect(page.getByTestId('section-invoicing')).toBeVisible();
    await expect(page.getByTestId('settings-past-invoices')).toHaveCount(0);
  });

  test('N+6: tax-rate radio block is HIDDEN when shop has no default VAT', async ({ page }) => {
    // Profile freshly onboarded with no VAT → block stays hidden.
    await bootstrap(page, { lang: 'en', defaultVatPct: null });
    await page.goto('/products/new');
    await expect(page.getByTestId('add-step-indicator')).toBeVisible();
    // The block is the optional final field of the pricing section.
    // Its absence is the contract; the basics ABOVE it (cost, sale,
    // notes) must still render so we know the form opened correctly.
    await expect(page.getByTestId('field-cost')).toBeVisible();
    await expect(page.getByTestId('field-tax')).toHaveCount(0);
  });

  test('N+6 (positive): tax-rate radio block renders when default VAT is set', async ({ page }) => {
    // Same form, same lang, but with a 19% default VAT in profile.
    // The radio block now appears, with "Shop default (19%)" pre-
    // selected and the helper line below.
    await bootstrap(page, { lang: 'en', defaultVatPct: 19 });
    await page.goto('/products/new');
    await expect(page.getByTestId('field-tax')).toBeVisible();
    // Pre-selected default → 'tax-shop-default' radio is checked.
    await expect(page.getByTestId('tax-shop-default')).toBeChecked();
    // Resolved label echoes the merchant's percent.
    await expect(page.getByTestId('tax-shop-default-row')).toContainText('19%');
    // Reduced label uses the v0.9 anchor (REDUCED_VAT_PCT_DEFAULT = 7).
    await expect(page.getByTestId('tax-reduced-row')).toContainText('7%');
    // Custom radio doesn't render the inline rate input until selected.
    await expect(page.getByTestId('field-tax-custom-rate')).toHaveCount(0);
    await page.getByTestId('tax-custom').click();
    await expect(page.getByTestId('field-tax-custom-rate')).toBeVisible();
  });

  test('N+8: tax labels are translated — EN / FR / AR', async ({ page }) => {
    // English copy first.
    await bootstrap(page, { lang: 'en', defaultVatPct: 20 });
    await page.goto('/products/new');
    await expect(page.getByTestId('field-tax')).toContainText('Tax rate');
    await expect(page.getByTestId('tax-shop-default-row')).toContainText('Shop default');
    await expect(page.getByTestId('tax-reduced-row')).toContainText('Reduced');
    await expect(page.getByTestId('tax-zero-row')).toContainText('Zero rated');
    await expect(page.getByTestId('tax-custom-row')).toContainText('Custom');

    // French.
    await bootstrap(page, { lang: 'fr', defaultVatPct: 20 });
    await page.goto('/products/new');
    await expect(page.getByTestId('field-tax')).toContainText('Taux de TVA');
    await expect(page.getByTestId('tax-shop-default-row')).toContainText('Taux boutique');
    await expect(page.getByTestId('tax-reduced-row')).toContainText('Réduit');
    await expect(page.getByTestId('tax-zero-row')).toContainText('Exonéré');
    await expect(page.getByTestId('tax-custom-row')).toContainText('Personnalisé');

    // Arabic — runs under RTL but the copy assertions don't care
    // about direction, only about the substring match.
    await bootstrap(page, { lang: 'ar', defaultVatPct: 20 });
    await page.goto('/products/new');
    await expect(page.getByTestId('field-tax')).toContainText('معدل الضريبة');
    await expect(page.getByTestId('tax-shop-default-row')).toContainText('افتراضي المتجر');
    await expect(page.getByTestId('tax-reduced-row')).toContainText('مخفض');
    await expect(page.getByTestId('tax-zero-row')).toContainText('معفى');
    await expect(page.getByTestId('tax-custom-row')).toContainText('مخصص');
  });
});
