import { expect, test, type Page } from '@playwright/test';

// v0.6.1 — cross-screen audit for the locale-aware location-label
// dropdown. The component (SelectWithCustom) and option lookup
// (LOCATION_OPTIONS) ship in v0.6 (ADR-029); the v0.6.1 hotfix
// realigned Settings to read the runtime UI locale. These specs
// cover the gaps the per-screen tests (75 + 78) don't:
//
//   • A custom value typed in onboarding survives across to Settings
//     and can be reverted to a predefined option from there.
//   • The onboarding dropdown and the Settings dropdown surface the
//     same option list under the same locale (the parity contract
//     that ADR-029 promises).

interface DropdownShape {
  values: string[];
  customLabel: string;
}

async function readDropdownShape(page: Page, testId: string): Promise<DropdownShape> {
  return page.getByTestId(testId).evaluate((el) => {
    const select = el as HTMLSelectElement;
    const opts = Array.from(select.options);
    const sentinel = opts[opts.length - 1];
    return {
      values: opts.slice(0, -1).map((o) => o.value),
      customLabel: sentinel?.textContent ?? '',
    };
  });
}

async function readPersistedFloor(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    return new Promise<string>((resolve, reject) => {
      dbReq.onsuccess = () => {
        const idb = dbReq.result;
        const tx = idb.transaction('profile', 'readonly');
        const req = tx.objectStore('profile').get('singleton');
        req.onsuccess = () => {
          const row = req.result as { location_floor_label?: string } | undefined;
          resolve(row?.location_floor_label ?? '');
        };
        req.onerror = () => reject(req.error);
      };
      dbReq.onerror = () => reject(dbReq.error);
    });
  });
}

// Walks a fresh merchant through onboarding all the way to the
// search screen. Mirrors the pattern in 75_locations_dropdown but
// keeps the locations step under the caller's control so the test
// can stamp custom values before continuing.
async function walkToLocations(page: Page, lang: string, shopName: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId(`lang-${lang}`).click();
  await page.getByTestId('intent-new').click();
  await page.getByTestId('onb-store-fashion').click();
  await page.getByTestId('shop-name-input').fill(shopName);
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-fashion-subtypes')).toBeVisible();
  await page.getByTestId('onb-subtype-clothing_men').click();
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-locations')).toBeVisible();
}

async function finishOnboarding(page: Page): Promise<void> {
  await page.getByTestId('continue').click();
  await expect(page.getByTestId('step-backup-card')).toBeVisible();
  await page.getByTestId('got-it').click();
  await expect(page.getByTestId('search-screen')).toBeVisible();
}

test.describe('v0.6.1 — location dropdown cross-screen audit', () => {
  test('custom "TTT" set in onboarding appears in Settings and can be reverted to a predefined option', async ({
    page,
  }) => {
    await walkToLocations(page, 'en', 'TTT Shop');

    // Pick "+ Type your own" for floor, type "TTT", commit via Tab.
    await page.getByTestId('onb-location-floor-select').selectOption('__custom__');
    const onbCustom = page.getByTestId('onb-location-floor-custom-input');
    await expect(onbCustom).toBeVisible();
    await onbCustom.fill('TTT');
    await onbCustom.press('Tab');
    await expect(onbCustom).toHaveValue('TTT');

    await finishOnboarding(page);
    // After onboarding completes, the profile should carry the typed
    // value verbatim — no auto-translation, no fallback.
    expect(await readPersistedFloor(page)).toBe('TTT');

    // Settings sees the same custom value in the same custom-input slot.
    await page.getByTestId('nav-settings').click();
    const settingsCustom = page.getByTestId('settings-location-floor-custom-input');
    await expect(settingsCustom).toBeVisible();
    await expect(settingsCustom).toHaveValue('TTT');

    // Reverting to a predefined option: clear + blur triggers
    // SelectWithCustom's empty-fallback, which writes options[0]
    // ("Shop floor") and swaps back into select mode.
    await settingsCustom.fill('');
    await settingsCustom.press('Tab');
    const settingsSelect = page.getByTestId('settings-location-floor-select');
    await expect(settingsSelect).toBeVisible();
    await expect(settingsSelect).toHaveValue('Shop floor');
    await expect.poll(() => readPersistedFloor(page)).toBe('Shop floor');

    // And the merchant can pick a different predefined option from the
    // restored select; the change persists.
    await settingsSelect.selectOption('Display');
    await expect.poll(() => readPersistedFloor(page)).toBe('Display');
  });

  test('parity: onboarding and Settings render the same option list under AR locale', async ({
    page,
  }) => {
    await walkToLocations(page, 'ar', 'Parity Shop');

    // Snapshot the onboarding dropdown shape (option values + custom
    // sentinel label) before continuing.
    const onbFloor = await readDropdownShape(page, 'onb-location-floor-select');
    const onbBack = await readDropdownShape(page, 'onb-location-back-select');
    expect(onbFloor.values).toEqual(['المحل', 'الواجهة', 'العرض']);
    expect(onbBack.values).toEqual(['المخزن', 'التخزين', 'المستودع']);
    expect(onbFloor.customLabel).toBe('+ اكتب الخاص بك');

    await finishOnboarding(page);
    await page.getByTestId('nav-settings').click();

    const settingsFloor = await readDropdownShape(page, 'settings-location-floor-select');
    const settingsBack = await readDropdownShape(page, 'settings-location-back-select');

    // Same component, same locale, same lookup → identical shape.
    expect(settingsFloor).toEqual(onbFloor);
    expect(settingsBack).toEqual(onbBack);
  });
});
