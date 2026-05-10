import { expect, test } from '@playwright/test';

// v0.5.2 ADR-021 — fashion vertical's onboarding subtypes step. The
// shop-vertical equivalent lives in test 35; this is the fashion-side
// counterpart, with the new categories + size-hint metadata.

test.describe('Onboarding — fashion sub-types', () => {
  test('fashion pick → fashion-subtypes step → multi-select + locations + saved profile', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    // 'fashion' is the default selection but click explicitly to be
    // independent of any future default change.
    await page.getByTestId('onb-store-fashion').click();
    await page.getByTestId('shop-name-input').fill('Boutique Yasmine');
    await page.getByTestId('continue').click();

    // The fashion-specific subtypes step is visible (not shop's).
    await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();
    await expect(page.getByTestId('step-shop-subtypes')).toHaveCount(0);

    // All 8 predefined fashion sub-types render in the picker.
    const ALL = [
      'shoes',
      'shoes_kids',
      'clothing_men',
      'clothing_women',
      'clothing_kids',
      'accessories',
      'bags',
      'jewelry',
    ] as const;
    for (const st of ALL) {
      await expect(page.getByTestId(`onb-subtype-${st}`)).toBeVisible();
    }

    // Continue is blocked until at least one is picked.
    await expect(page.getByTestId('continue')).toBeDisabled();

    // Pick two — chips toggle independently.
    await page.getByTestId('onb-subtype-clothing_men').click();
    await page.getByTestId('onb-subtype-bags').click();
    await expect(page.getByTestId('onb-subtype-clothing_men')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('onb-subtype-bags')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('onb-subtype-shoes')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('continue')).toBeEnabled();

    await page.getByTestId('continue').click();
    // Locations step then backup card.
    await expect(page.getByTestId('step-locations')).toBeVisible();
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-backup-card')).toBeVisible();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Profile persisted with store_type='fashion' + the two sub-types.
    const profile = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ store_type: string; fashion_subtypes: string[] }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as
              | { store_type?: string; fashion_subtypes?: string[] }
              | undefined;
            resolve({
              store_type: row?.store_type ?? '?',
              fashion_subtypes: row?.fashion_subtypes ?? [],
            });
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(profile.store_type).toBe('fashion');
    expect(profile.fashion_subtypes.sort()).toEqual(['bags', 'clothing_men'].sort());
  });
});
