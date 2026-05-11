import { expect, test, type Page } from '@playwright/test';

// v0.5.6 Issue 7 — sub-type pre-selection audit.
//
// New profile onboarding flow: zero sub-types ticked; Continue
// disabled until ≥1 is picked. Existing coverage:
// 52_onboarding_fashion_subtypes verifies that Continue is disabled at
// the start of the fashion-subtypes step. We don't duplicate it here.
//
// MIGRATED profile flow (the path this spec covers): when a pre-v9
// 'shoes' profile is migrated to fashion+['shoes'] OR a 'clothes'
// profile to fashion+['clothing_men', 'clothing_women'], the
// /migrations/confirm-subtypes screen must show those auto-assigned
// sub-types PRE-TICKED so the merchant sees their starting setup.

async function seedMigratedShoesProfile(page: Page): Promise<void> {
  await page.goto('/');
  // Use the seed surface to plant a fashion profile carrying the
  // v8→v9 migration outcome, then set the meta keys that route the
  // merchant to the confirm-subtypes screen.
  await page.evaluate(async () => {
    await window.__inventarSeed!.seed({
      shopName: 'Test Shoe Shop',
      locale: 'en',
      storeType: 'fashion',
      fashionSubtypes: ['shoes'],
      reset: true,
    });
  });
  // Write the migration meta keys directly (the seed surface doesn't
  // expose them). The confirm-subtypes screen guards on:
  //   migration_v9_completed_at SET
  //   migration_v9_subtypes_confirmed_at NOT SET
  await page.evaluate(async () => {
    const open = indexedDB.open('inventar');
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({
        key: 'migration_v9_completed_at',
        value: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  });
}

test.describe('Sub-type pre-selection (v0.5.6 Issue 7)', () => {
  test('Migrated shoes profile lands on confirm-subtypes with [shoes] pre-ticked', async ({
    page,
  }) => {
    await seedMigratedShoesProfile(page);
    await page.goto('/migrations/confirm-subtypes');
    await expect(page.getByTestId('confirm-subtypes-screen')).toBeVisible();
    // 'shoes' is pre-ticked because the seeded profile carries
    // fashion_subtypes=['shoes'] and the screen initialises the
    // draft from that array.
    await expect(page.getByTestId('confirm-subtype-shoes')).toHaveAttribute('aria-pressed', 'true');
    // None of the others are ticked.
    for (const st of [
      'shoes_kids',
      'clothing_men',
      'clothing_women',
      'clothing_kids',
      'accessories',
      'bags',
      'jewelry',
    ]) {
      await expect(page.getByTestId(`confirm-subtype-${st}`)).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    }
    // Save is enabled because at least one is ticked.
    await expect(page.getByTestId('confirm-subtypes-save')).toBeEnabled();
  });

  test('Migrated clothes profile pre-ticks both clothing_men and clothing_women', async ({
    page,
  }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Test Clothes Shop',
        locale: 'en',
        storeType: 'fashion',
        fashionSubtypes: ['clothing_men', 'clothing_women'],
        reset: true,
      });
      const open = indexedDB.open('inventar');
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({
          key: 'migration_v9_completed_at',
          value: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    });
    await page.goto('/migrations/confirm-subtypes');
    await expect(page.getByTestId('confirm-subtypes-screen')).toBeVisible();
    await expect(page.getByTestId('confirm-subtype-clothing_men')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('confirm-subtype-clothing_women')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('confirm-subtype-shoes')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
