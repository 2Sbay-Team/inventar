import { expect, test } from '@playwright/test';

// v0.5 ADR-017: when the merchant picks "Shop" at onboarding, a fourth
// step appears between the shop-name page and the backup-card page asking
// which sub-types of goods the shop sells. ≥1 selection is required and
// the union of selected sub-types' default categories drives the Add
// Article category chip list. Settings exposes the same picker so the
// merchant can change their selection later.

test.describe('Onboarding — shop sub-types', () => {
  test('shop pick → sub-types step → multi-select → profile saved with both sub-types + Add Article shows union of categories', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();

    // The new step is gated on storeType==='shop' — visible now.
    await expect(page.getByTestId('step-shop-subtypes')).toBeVisible();

    // All 8 canonical sub-types render.
    const ALL_SUBTYPES = [
      'food_beverages',
      'tobacco_lottery',
      'snacks_confectionery',
      'personal_care',
      'household_cleaning',
      'parapharmaceutique',
      'stationery',
      'other',
    ] as const;
    for (const st of ALL_SUBTYPES) {
      await expect(page.getByTestId(`onb-subtype-${st}`)).toBeVisible();
    }

    // Continue is blocked until at least one sub-type is selected.
    await expect(page.getByTestId('continue')).toBeDisabled();

    // Pick two sub-types — chips toggle independently.
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('onb-subtype-tobacco_lottery').click();
    await expect(page.getByTestId('onb-subtype-food_beverages')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('onb-subtype-tobacco_lottery')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('onb-subtype-personal_care')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('continue')).toBeEnabled();

    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-backup-card')).toBeVisible();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Profile persisted with both sub-types + store_type='shop'.
    const profile = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ store_type: string; shop_subtypes: string[] }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as { store_type?: string; shop_subtypes?: string[] } | undefined;
            resolve({
              store_type: row?.store_type ?? '?',
              shop_subtypes: row?.shop_subtypes ?? [],
            });
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(profile.store_type).toBe('shop');
    expect(profile.shop_subtypes.sort()).toEqual(['food_beverages', 'tobacco_lottery'].sort());

    // Add Article (Step 1) shows the category chips drawn from the union
    // of food_beverages (produce, dairy, dry_goods, frozen, beverages,
    // bakery) + tobacco_lottery (tobacco, lottery, phone_credit) — 9
    // unique categories. We assert presence of one category from each
    // sub-type to prove the union actually fired (vs. just the static
    // fallback list from STORE_TYPES.shop.categories).
    //
    // v0.5 ADR-018: shop bottom nav replaces Add with Receive. We
    // navigate to /add directly to verify the chip list — Add Article
    // is still reachable, just not surfaced in the primary nav.
    await page.goto('/add');
    await expect(page.getByTestId('step-1')).toBeVisible();
    await expect(page.getByTestId('category-produce')).toBeVisible();
    await expect(page.getByTestId('category-tobacco')).toBeVisible();
    await expect(page.getByTestId('category-bakery')).toBeVisible();
    await expect(page.getByTestId('category-phone_credit')).toBeVisible();
    // Static-fallback categories (from STORE_TYPES.shop.categories) must
    // NOT leak through when sub-types are set. 'food' / 'drinks' / 'snacks'
    // / 'household' / 'personal_care' are the fallback strings; they
    // don't match anything in the food_beverages or tobacco_lottery
    // sub-type lists.
    await expect(page.getByTestId('category-food')).toHaveCount(0);
    await expect(page.getByTestId('category-drinks')).toHaveCount(0);
    await expect(page.getByTestId('category-household')).toHaveCount(0);
  });

  test('non-shop verticals skip the sub-types step', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await expect(page.getByTestId('step-name')).toBeVisible();
    // Default selection is shoes; no sub-types step expected.
    await page.getByTestId('shop-name-input').fill('Shoe Shop');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-shop-subtypes')).toHaveCount(0);
    await expect(page.getByTestId('step-backup-card')).toBeVisible();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Profile.shop_subtypes defaults to [] for non-shop verticals.
    const profile = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<{ store_type: string; shop_subtypes: string[] }>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as { store_type?: string; shop_subtypes?: string[] } | undefined;
            resolve({
              store_type: row?.store_type ?? '?',
              shop_subtypes: row?.shop_subtypes ?? [],
            });
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(profile.store_type).toBe('shoes');
    expect(profile.shop_subtypes).toEqual([]);
  });
});

test.describe('Settings — shop sub-types editor', () => {
  test('section visible only for shop vertical; toggle + Save persists across reload', async ({
    page,
  }) => {
    // Onboard as shop with one sub-type so the editor has a starting state.
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Editor Test');
    await page.getByTestId('continue').click();
    await page.getByTestId('onb-subtype-food_beverages').click();
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    // Settings → the new shop-subtypes section is visible.
    await page.getByTestId('nav-settings').click();
    const section = page.getByTestId('section-shop-subtypes');
    await expect(section).toBeVisible();

    // food_beverages chip starts pressed (was set at onboarding).
    await expect(page.getByTestId('settings-subtype-food_beverages')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('settings-subtype-personal_care')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // v0.5.1: immediate-save semantics. No Save button — every chip
    // tap writes upsertProfile inline. The "min one" invariant is
    // protected by disabling the chip when it's the LAST selected
    // sub-type (so the merchant can't end up with zero).

    // Add personal_care (now [food_beverages, personal_care]).
    await page.getByTestId('settings-subtype-personal_care').click();
    await expect(page.getByTestId('settings-subtype-personal_care')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Drop food_beverages (now [personal_care]).
    await page.getByTestId('settings-subtype-food_beverages').click();
    await expect(page.getByTestId('settings-subtype-food_beverages')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // personal_care is now the last selected — should be disabled to
    // protect the ≥1 invariant.
    await expect(page.getByTestId('settings-subtype-personal_care')).toBeDisabled();

    // Reload and confirm the new selection persisted.
    await page.reload();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-subtype-personal_care')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('settings-subtype-food_beverages')).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Storage check.
    const subs = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      return new Promise<string[]>((resolve, reject) => {
        dbReq.onsuccess = () => {
          const idb = dbReq.result;
          const tx = idb.transaction('profile', 'readonly');
          const req = tx.objectStore('profile').get('singleton');
          req.onsuccess = () => {
            const row = req.result as { shop_subtypes?: string[] } | undefined;
            resolve(row?.shop_subtypes ?? []);
          };
          req.onerror = () => reject(req.error);
        };
        dbReq.onerror = () => reject(dbReq.error);
      });
    });
    expect(subs).toEqual(['personal_care']);
  });

  test('section hidden when store_type is not shop', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    // Default is shoes — section-shop-subtypes should not render.
    await page.getByTestId('shop-name-input').fill('No Subtypes Here');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('section-shop-subtypes')).toHaveCount(0);
  });
});
