import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.6 ADR-031 — end-to-end specs for the update-consent modal.
//
// The full SW deploy → waiting → activated lifecycle is too flaky to
// drive deterministically under playwright-headless (see the comment
// at the top of test 26 for the reasoning). Instead these specs use a
// test seam: __inventarSeed.triggerUpdateWaiting() installs a fake
// SwHandle in the browser context and fires the 'waiting' event. The
// hook reacts exactly as it would for a real new SW: fetches
// /whats-new.json, gates against snooze/skip, then opens the modal.
//
// The IDB-state contracts (snooze, skip) are pinned at the unit level
// in src/hooks/use-app-update.test.ts; these specs verify the modal
// behaviour + IDB writes on click + the post-reload toast.

interface UpdateMetaSnapshot {
  snoozedVersion: string | null;
  snoozeUntil: string | null;
  skipped: readonly string[];
  justInstalled: string | null;
}

async function readUpdateMeta(page: Page): Promise<UpdateMetaSnapshot> {
  return page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      dbReq.onsuccess = () => resolve(dbReq.result);
      dbReq.onerror = () => reject(dbReq.error);
    });
    function getKey(key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const tx = idb.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get(key);
        req.onsuccess = () => resolve((req.result as { value?: unknown } | undefined)?.value);
        req.onerror = () => reject(req.error);
      });
    }
    return {
      snoozedVersion: ((await getKey('update_snoozed_version')) as string | undefined) ?? null,
      snoozeUntil: ((await getKey('update_snooze_until')) as string | undefined) ?? null,
      skipped: ((await getKey('update_skipped_versions')) as readonly string[] | undefined) ?? [],
      justInstalled: ((await getKey('update_just_installed')) as string | undefined) ?? null,
    };
  });
}

async function seedAndTriggerUpdate(page: Page): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Update Shop',
    storeType: 'fashion',
    fashionSubtypes: ['clothing_men'],
  });
  await page.reload();
  // The useAppUpdate hook subscribes to 'waiting' in a useEffect that
  // runs after React mount. Wait for the post-onboarding shell to be
  // visible (proves the tree mounted) BEFORE firing the fake event —
  // otherwise the test races the hook's subscribe call and the modal
  // never appears.
  await expect(page.getByTestId('search-screen')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.__inventarSeed!.triggerUpdateWaiting());
}

test.describe('App update — consent modal', () => {
  test('renders with version, three highlights, and the three buttons', async ({ page }) => {
    await seedAndTriggerUpdate(page);
    const modal = page.getByTestId('app-update-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    // Title carries the version from /whats-new.json (currently 1.0.1).
    await expect(page.getByTestId('app-update-title')).toContainText('1.0.1');
    // Three highlight bullets render.
    const highlights = page.locator('[data-testid="app-update-highlights"] li');
    await expect(highlights).toHaveCount(3);
    // Three action buttons.
    await expect(page.getByTestId('app-update-install')).toBeVisible();
    await expect(page.getByTestId('app-update-snooze')).toBeVisible();
    await expect(page.getByTestId('app-update-skip')).toBeVisible();
  });

  test('Snooze writes a 24 h window and closes the modal; re-trigger does NOT re-show', async ({
    page,
  }) => {
    await seedAndTriggerUpdate(page);
    await expect(page.getByTestId('app-update-modal')).toBeVisible();
    const before = Date.now();
    await page.getByTestId('app-update-snooze').click();
    await expect(page.getByTestId('app-update-modal')).toBeHidden();

    const meta = await readUpdateMeta(page);
    expect(meta.snoozedVersion).toBe('1.0.1');
    expect(meta.snoozeUntil).not.toBeNull();
    const untilMs = Date.parse(meta.snoozeUntil!);
    // ≈ 24 h ahead — tolerate ± 60 s for clock drift across the
    // evaluate boundary.
    const expected = before + 24 * 60 * 60 * 1000;
    expect(Math.abs(untilMs - expected)).toBeLessThan(60_000);

    // Re-trigger the 'waiting' event — the modal must stay hidden
    // because the snooze for v1.0.1 is still active.
    await page.evaluate(() => window.__inventarSeed!.triggerUpdateWaiting());
    await expect(page.getByTestId('app-update-modal')).toBeHidden();
  });

  test('Skip appends to skipped_versions; re-trigger never re-shows for the same version', async ({
    page,
  }) => {
    await seedAndTriggerUpdate(page);
    await expect(page.getByTestId('app-update-modal')).toBeVisible();
    await page.getByTestId('app-update-skip').click();
    await expect(page.getByTestId('app-update-modal')).toBeHidden();

    const meta = await readUpdateMeta(page);
    expect(meta.skipped).toContain('1.0.1');

    await page.evaluate(() => window.__inventarSeed!.triggerUpdateWaiting());
    await expect(page.getByTestId('app-update-modal')).toBeHidden();
  });

  test('Install now activates the waiting SW, writes update_just_installed, then reloads', async ({
    page,
  }) => {
    await seedAndTriggerUpdate(page);
    await expect(page.getByTestId('app-update-modal')).toBeVisible();

    // Trigger Install + wait for the reload. After reload the fake
    // handle's counter is reset (it lives in the page's module scope),
    // so we can't assert it post-reload — the meaningful proof is the
    // chain "meta.update_just_installed written → page reloaded → post-
    // reload toast surfaces", which we verify below.
    const navigationPromise = page.waitForLoadState('load');
    await page.getByTestId('app-update-install').click();
    await navigationPromise;

    // The post-reload toast surfaces because meta.update_just_installed
    // was written before the reload and the toast component reads it
    // on mount.
    await expect(page.getByTestId('app-update-toast')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('app-update-toast')).toContainText('1.0.1');

    // Toast auto-dismisses after ~4 s.
    await expect(page.getByTestId('app-update-toast')).toBeHidden({ timeout: 6_000 });

    // The toast component cleared the meta key so a subsequent reload
    // doesn't re-surface it.
    await page.reload();
    await expect(page.getByTestId('app-update-toast')).toBeHidden();
  });

  test('whats-new.json failure falls back to the generic message', async ({ page }) => {
    // Block the cache-busted whats-new request before the hook fetches.
    await page.route('**/whats-new.json*', (route) => route.abort('failed'));

    await seedAndTriggerUpdate(page);
    await expect(page.getByTestId('app-update-modal')).toBeVisible();
    await expect(page.getByTestId('app-update-fallback')).toBeVisible();
    // Title uses the generic (no-version) variant.
    await expect(page.getByTestId('app-update-title')).not.toContainText('v0.');
    // Highlights list is absent.
    await expect(page.locator('[data-testid="app-update-highlights"]')).toHaveCount(0);

    // Skip still works under the fallback path — the modal must not
    // re-show after the merchant skips the unknown-version sentinel.
    await page.getByTestId('app-update-skip').click();
    await expect(page.getByTestId('app-update-modal')).toBeHidden();
    await page.evaluate(() => window.__inventarSeed!.triggerUpdateWaiting());
    await expect(page.getByTestId('app-update-modal')).toBeHidden();
  });
});

// Extend the seed surface typing the harness exposes so this spec
// compiles without `as unknown as`.
declare global {
  interface Window {
    __inventarSeed?: {
      seed: (input: unknown) => Promise<void>;
      sellOne: (articleName: string, size: string) => Promise<void>;
      reset: () => Promise<void>;
      deleteDb: () => Promise<void>;
      exportJson: () => Promise<string>;
      simulateScan: (value: string) => void;
      triggerUpdateWaiting: () => void;
      getUpdateActivateCalls: () => number;
    };
  }
}
