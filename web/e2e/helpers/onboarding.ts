import { type Page, expect } from '@playwright/test';
import { type Locale } from '../../src/types';

declare global {
  interface Window {
    __inventarSeed?: {
      seed: (input: unknown) => Promise<void>;
      sellOne: (articleName: string, size: string) => Promise<void>;
      reset: () => Promise<void>;
      deleteDb: () => Promise<void>;
      exportJson: () => Promise<string>;
    };
  }
}

// Walks through the onboarding screens via the UI.
export async function onboardViaUI(
  page: Page,
  options: { lang: Locale; shopName: string },
): Promise<void> {
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId(`lang-${options.lang}`).click();
  await expect(page.getByTestId('step-intent')).toBeVisible();
  await page.getByTestId('intent-new').click();
  await expect(page.getByTestId('step-name')).toBeVisible();
  await page.getByTestId('shop-name-input').fill(options.shopName);
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-backup-card')).toBeVisible();
  await page.getByTestId('got-it').click();
  await expect(page.getByTestId('search-screen')).toBeVisible();
}

// Skips onboarding by writing the profile + locale directly via the seed
// surface. Faster than UI walk for tests that don't care about onboarding.
export async function onboardViaSeed(
  page: Page,
  options: { lang: Locale; shopName: string },
): Promise<void> {
  await page.evaluate(async (input) => {
    const api = window.__inventarSeed;
    if (!api) throw new Error('__inventarSeed not mounted — build with VITE_E2E=true');
    await api.seed({
      shopName: input.shopName,
      locale: input.lang,
      reset: true,
    });
  }, options);
}
