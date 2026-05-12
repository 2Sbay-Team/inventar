import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6.1 hotfix — the location dropdown in Settings reads its option
// list from the runtime UI locale, not the profile's frozen-at-
// onboarding locale. Merchants who onboarded in EN and later switched
// the UI to FR/AR should see FR/AR options; stored values stay
// verbatim per ADR-022 (no auto-translation).
//
// Onboarding already uses useLocale() so its dropdown is correct;
// the existing 75_locations_dropdown.spec.ts covers that path. This
// file covers Settings + the language-switching scenario.

interface SelectShape {
  values: string[];
  customLabel: string;
}

async function readSelectShape(page: Page, testId: string): Promise<SelectShape> {
  return page.getByTestId(testId).evaluate((el) => {
    const select = el as HTMLSelectElement;
    const opts = Array.from(select.options);
    // Last option is the "+ Type your own" sentinel; the visible
    // label is locale-translated, the value is the sentinel string.
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

test.describe('v0.6.1 — Settings location dropdown follows UI locale', () => {
  test('EN locale: floor lists Shop floor/Display/Front + "+ Type your own"', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'EN Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    const floor = await readSelectShape(page, 'settings-location-floor-select');
    expect(floor.values).toEqual(['Shop floor', 'Display', 'Front']);
    expect(floor.customLabel).toBe('+ Type your own');

    const back = await readSelectShape(page, 'settings-location-back-select');
    expect(back.values).toEqual(['Stockroom', 'Storage', 'Back']);
    expect(back.customLabel).toBe('+ Type your own');
  });

  test('FR locale: floor lists Magasin/Boutique/Comptoir + "+ Saisir le vôtre"', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'fr',
      shopName: 'FR Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    const floor = await readSelectShape(page, 'settings-location-floor-select');
    expect(floor.values).toEqual(['Magasin', 'Boutique', 'Comptoir']);
    expect(floor.customLabel).toBe('+ Saisir le vôtre');

    const back = await readSelectShape(page, 'settings-location-back-select');
    expect(back.values).toEqual(['Réserve', 'Stock', 'Arrière']);
    expect(back.customLabel).toBe('+ Saisir le vôtre');
  });

  test('AR locale: floor lists المحل/الواجهة/العرض + "+ اكتب الخاص بك", select is RTL', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'ar',
      shopName: 'AR Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    const floor = await readSelectShape(page, 'settings-location-floor-select');
    expect(floor.values).toEqual(['المحل', 'الواجهة', 'العرض']);
    expect(floor.customLabel).toBe('+ اكتب الخاص بك');

    const back = await readSelectShape(page, 'settings-location-back-select');
    expect(back.values).toEqual(['المخزن', 'التخزين', 'المستودع']);

    // SelectWithCustom resolves dir from i18next.dir(); AR is rtl.
    await expect(page.getByTestId('settings-location-floor-select')).toHaveAttribute('dir', 'rtl');
    const htmlDir = await page.evaluate(() => document.documentElement.dir);
    expect(htmlDir).toBe('rtl');
  });

  test('switching UI language EN → FR refreshes the dropdown options live', async ({ page }) => {
    // The bug this hotfix targets: onboarded in one locale, switched to
    // another at runtime, dropdown previously stuck on the original
    // locale because Settings read profile.locale instead of i18next.
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Switch Shop',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // Baseline: EN options.
    const beforeFloor = await readSelectShape(page, 'settings-location-floor-select');
    expect(beforeFloor.values).toEqual(['Shop floor', 'Display', 'Front']);

    // Switch UI to FR. The persisted "Shop floor" value is not in the
    // FR option list, so SelectWithCustom drops into custom-input mode
    // with "Shop floor" pre-filled.
    await page.getByTestId('settings-lang-fr').click();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toBeVisible();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue(
      'Shop floor',
    );

    // Replace with a predefined FR option. The component recognises it
    // and swaps back into select mode, surfacing the FR option list.
    const customInput = page.getByTestId('settings-location-floor-custom-input');
    await customInput.fill('Magasin');
    await customInput.press('Tab');

    const floor = await readSelectShape(page, 'settings-location-floor-select');
    expect(floor.values).toEqual(['Magasin', 'Boutique', 'Comptoir']);
    expect(floor.customLabel).toBe('+ Saisir le vôtre');
    await expect(page.getByTestId('settings-location-floor-select')).toHaveValue('Magasin');

    await expect.poll(() => readPersistedFloor(page)).toBe('Magasin');
  });

  test('custom value typed in EN is preserved verbatim when switching to AR', async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Custom Survive',
      storeType: 'fashion',
      fashionSubtypes: ['clothing_men'],
    });
    await page.reload();
    await page.getByTestId('nav-settings').click();

    // Type a custom value in EN.
    await page.getByTestId('settings-location-floor-select').selectOption('__custom__');
    const customInput = page.getByTestId('settings-location-floor-custom-input');
    await customInput.fill('Atelier');
    await customInput.press('Tab');
    await expect.poll(() => readPersistedFloor(page)).toBe('Atelier');

    // Switch UI to AR. "Atelier" is not in the AR option list either,
    // so the custom-input stays visible with the typed value intact.
    await page.getByTestId('settings-lang-ar').click();
    await expect(page.getByTestId('settings-location-floor-custom-input')).toHaveValue('Atelier');
    // And the persisted profile row is unchanged — no auto-translation.
    expect(await readPersistedFloor(page)).toBe('Atelier');
  });
});
