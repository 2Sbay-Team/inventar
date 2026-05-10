import { expect, test, type Page } from '@playwright/test';

// v0.5.2 ADR-021 / ADR-022 / ADR-023 — end-to-end smoke for the v8 → v9
// migration. Mirrors the kernel's vitest cases (migrate-v8-to-v9.test.ts)
// but drives them through a real Dexie open(): we hand-seed v7 rows into
// the live `inventar` IndexedDB BEFORE the app boots, then reload and
// assert the upgraded shape.
//
// Why we seed at v7 (not v8): opening at v7 forces Dexie's upgrade
// pipeline to run v7→v8 AND v8→v9 in one shot, which is what real
// installs hit. Going v7 directly to v9 also exercises the chained
// path (v6→v7's pre-fill → v8→v9's overwrite of placeholder labels).
//
// Pattern follows e2e/tests/34_v6_v7_migration.spec.ts: deleteDb via
// the test seed surface (closes the live Dexie connection cleanly),
// then open raw IndexedDB at v7 and write the seed in the same open
// callback before closing + reloading.

const NOW = '2026-05-08T00:00:00.000Z';

interface SeedProfile {
  id: 'singleton';
  name: string;
  locale: 'en' | 'fr' | 'ar';
  logo_photo_id: null;
  currency: string;
  store_type: string;
  shop_subtypes: string[];
  created_at: string;
  updated_at: string;
  last_backup_at: null;
}

async function readProfile(page: Page): Promise<{
  store_type: string;
  shop_subtypes: string[];
  fashion_subtypes: string[];
  location_floor_label: string;
  location_back_label: string;
  expiry_warning_days: number;
}> {
  return page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('inventar');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const row = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = idb.transaction('profile', 'readonly');
      const r = tx.objectStore('profile').get('singleton');
      r.onsuccess = () => resolve(r.result as Record<string, unknown>);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return {
      store_type: row.store_type as string,
      shop_subtypes: (row.shop_subtypes as string[]) ?? [],
      fashion_subtypes: (row.fashion_subtypes as string[]) ?? [],
      location_floor_label: (row.location_floor_label as string) ?? '',
      location_back_label: (row.location_back_label as string) ?? '',
      expiry_warning_days: (row.expiry_warning_days as number) ?? -1,
    };
  });
}

test.describe('v8 → v9 migration smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Land on the app once so __inventarSeed mounts, then close + delete
    // the DB so we can re-create it at v7 with our seed payload. The
    // close happens inside deleteDb(); without it, IndexedDB rejects
    // a same-name re-open at a lower version.
    await page.goto('/');
    await page.waitForFunction(() => Boolean(window.__inventarSeed));
    await page.evaluate(async () => {
      await window.__inventarSeed!.deleteDb();
    });
  });

  async function seedV7AndReload(
    page: Page,
    profile: SeedProfile,
    meta?: { expiry_threshold_days?: number },
  ): Promise<void> {
    await page.evaluate(
      async (args) => {
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('inventar', 7);
          req.onupgradeneeded = () => {
            const idb = req.result;
            // Mirror the v7 schema's set of object stores. We don't add
            // indexes — Dexie's upgrade pipeline rebuilds them on the
            // way to v9.
            idb.createObjectStore('profile', { keyPath: 'id' });
            idb.createObjectStore('articles', { keyPath: 'id' });
            idb.createObjectStore('variants', { keyPath: 'id' });
            idb.createObjectStore('movements', { keyPath: 'id' });
            idb.createObjectStore('expenses', { keyPath: 'id' });
            idb.createObjectStore('photos', { keyPath: 'id' });
            idb.createObjectStore('meta', { keyPath: 'key' });
            idb.createObjectStore('lots', { keyPath: 'id' });
          };
          req.onsuccess = () => {
            const idb = req.result;
            const tx = idb.transaction(['profile', 'meta'], 'readwrite');
            tx.oncomplete = () => {
              idb.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
            tx.objectStore('profile').add(args.profile);
            if (args.meta?.expiry_threshold_days != null) {
              tx.objectStore('meta').add({
                key: 'expiry_threshold_days',
                value: args.meta.expiry_threshold_days,
              });
            }
          };
          req.onerror = () => reject(req.error);
        });
      },
      { profile, meta: meta ?? {} },
    );
    await page.goto('/');
    // Give the upgrade pipeline a beat to land before we read.
    await page.waitForFunction(() => Boolean(window.__inventarSeed));
  }

  test('shoes/fr profile → fashion + fashion_subtypes=[shoes] + Boutique/Réserve', async ({
    page,
  }) => {
    await seedV7AndReload(page, {
      id: 'singleton',
      name: 'Naili Shoes',
      locale: 'fr',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'shoes',
      shop_subtypes: [],
      created_at: NOW,
      updated_at: NOW,
      last_backup_at: null,
    });
    const p = await readProfile(page);
    expect(p.store_type).toBe('fashion');
    expect(p.fashion_subtypes).toEqual(['shoes']);
    expect(p.shop_subtypes).toEqual([]);
    expect(p.location_floor_label).toBe('Boutique');
    expect(p.location_back_label).toBe('Réserve');
    expect(p.expiry_warning_days).toBe(7);
  });

  test('clothes/ar profile → fashion + men+women + Arabic labels', async ({ page }) => {
    await seedV7AndReload(page, {
      id: 'singleton',
      name: 'Boutique Ali',
      locale: 'ar',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'clothes',
      shop_subtypes: [],
      created_at: NOW,
      updated_at: NOW,
      last_backup_at: null,
    });
    const p = await readProfile(page);
    expect(p.store_type).toBe('fashion');
    expect(p.fashion_subtypes).toEqual(['clothing_men', 'clothing_women']);
    expect(p.location_floor_label).toBe('المحل');
    expect(p.location_back_label).toBe('المخزن');
  });

  test('shop/en preserves shop_subtypes (incl. legacy keys) + sets shop labels', async ({
    page,
  }) => {
    await seedV7AndReload(page, {
      id: 'singleton',
      name: 'Mini Mart',
      locale: 'en',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'shop',
      shop_subtypes: ['food_beverages', 'tobacco_lottery', 'parapharmaceutique'],
      created_at: NOW,
      updated_at: NOW,
      last_backup_at: null,
    });
    const p = await readProfile(page);
    expect(p.store_type).toBe('shop');
    // The two legacy keys round-trip — they're not predefined in the new
    // picker, but existing profiles must keep their categorisation.
    expect(p.shop_subtypes).toEqual(['food_beverages', 'tobacco_lottery', 'parapharmaceutique']);
    expect(p.fashion_subtypes).toEqual([]);
    expect(p.location_floor_label).toBe('Shelf');
    expect(p.location_back_label).toBe('Stockroom');
  });

  test('expiry_threshold_days meta is copied to expiry_warning_days', async ({ page }) => {
    await seedV7AndReload(
      page,
      {
        id: 'singleton',
        name: 'Mini Mart',
        locale: 'en',
        logo_photo_id: null,
        currency: 'TND',
        store_type: 'shop',
        shop_subtypes: ['food_beverages'],
        created_at: NOW,
        updated_at: NOW,
        last_backup_at: null,
      },
      { expiry_threshold_days: 14 },
    );
    const p = await readProfile(page);
    expect(p.expiry_warning_days).toBe(14);
  });

  test('idempotency: re-loading the page does NOT re-run the migration body', async ({ page }) => {
    await seedV7AndReload(page, {
      id: 'singleton',
      name: 'Re-run Test',
      locale: 'en',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'shoes',
      shop_subtypes: [],
      created_at: NOW,
      updated_at: NOW,
      last_backup_at: null,
    });
    const completedAt1 = await page.evaluate(async () => {
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const row = await new Promise<{ value?: string } | undefined>((resolve) => {
        const tx = idb.transaction('meta', 'readonly');
        const r = tx.objectStore('meta').get('migration_v9_completed_at');
        r.onsuccess = () => resolve(r.result as { value?: string } | undefined);
        r.onerror = () => resolve(undefined);
      });
      idb.close();
      return row?.value;
    });
    expect(completedAt1).toBeTruthy();

    // Reload + read the timestamp again. Idempotency means it MUST be
    // the exact same string (the upgrade body re-running would write a
    // new timestamp).
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__inventarSeed));
    const completedAt2 = await page.evaluate(async () => {
      const idb = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const row = await new Promise<{ value?: string } | undefined>((resolve) => {
        const tx = idb.transaction('meta', 'readonly');
        const r = tx.objectStore('meta').get('migration_v9_completed_at');
        r.onsuccess = () => resolve(r.result as { value?: string } | undefined);
        r.onerror = () => resolve(undefined);
      });
      idb.close();
      return row?.value;
    });
    expect(completedAt2).toBe(completedAt1);
  });
});
