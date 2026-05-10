import { type Page, expect } from '@playwright/test';
import { type Locale, type ShopSubtype, type StoreType } from '../../src/types';

declare global {
  interface Window {
    __inventarSeed?: {
      seed: (input: unknown) => Promise<void>;
      sellOne: (articleName: string, size: string) => Promise<void>;
      reset: () => Promise<void>;
      deleteDb: () => Promise<void>;
      exportJson: () => Promise<string>;
      simulateScan: (value: string) => void;
    };
  }
}

// Walks through the onboarding screens via the UI. v0.5 ADR-017: when
// `storeType === 'shop'` and `shopSubtypes` are passed, walks the new
// sub-types step that lives between `name` and `backup_card`.
export async function onboardViaUI(
  page: Page,
  options: {
    lang: Locale;
    shopName: string;
    storeType?: StoreType;
    shopSubtypes?: ShopSubtype[];
  },
): Promise<void> {
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId(`lang-${options.lang}`).click();
  await expect(page.getByTestId('step-intent')).toBeVisible();
  await page.getByTestId('intent-new').click();
  await expect(page.getByTestId('step-name')).toBeVisible();
  if (options.storeType) {
    await page.getByTestId(`onb-store-${options.storeType}`).click();
  }
  await page.getByTestId('shop-name-input').fill(options.shopName);
  await page.getByTestId('continue').click();
  if (options.storeType === 'shop') {
    await expect(page.getByTestId('step-shop-subtypes')).toBeVisible();
    for (const st of options.shopSubtypes ?? ['food_beverages']) {
      await page.getByTestId(`onb-subtype-${st}`).click();
    }
    await page.getByTestId('continue').click();
  }
  await expect(page.getByTestId('step-backup-card')).toBeVisible();
  await page.getByTestId('got-it').click();
  await expect(page.getByTestId('search-screen')).toBeVisible();
}

// Skips onboarding by writing the profile + locale directly via the seed
// surface. Faster than UI walk for tests that don't care about onboarding.
export async function onboardViaSeed(
  page: Page,
  options: {
    lang: Locale;
    shopName: string;
    storeType?: StoreType;
    shopSubtypes?: ShopSubtype[];
  },
): Promise<void> {
  await page.evaluate(async (input) => {
    const api = window.__inventarSeed;
    if (!api) throw new Error('__inventarSeed not mounted — build with VITE_E2E=true');
    await api.seed({
      shopName: input.shopName,
      locale: input.lang,
      storeType: input.storeType,
      shopSubtypes: input.shopSubtypes,
      reset: true,
    });
  }, options);
}
