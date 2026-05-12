import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// SPEC §1.9 / ADR-008: Add Article persists a photo as a Blob in IndexedDB,
// compressed to ≤ 200 KB. After a full reload the photo is still there
// and rendered as a Blob URL (not over the network).

test.describe('Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Persistence Shop' });
    await page.reload();
  });

  test('photo survives a full reload and is ≤ 200 KB', async ({ page }) => {
    await page.goto('/add');
    // v0.3: Add Article is two steps — basics on Step 1, photo + variants
    // on Step 2. Photo lives inside the first colour block.
    await page.getByTestId('field-name').fill('Persistence shoe');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('70');
    await page.getByTestId('continue').click();
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-white').click();
    await page.getByTestId('block-0-size-0-input').fill('42');
    await page.getByTestId('block-0-size-0-back-plus').click();
    await page.getByTestId('save').click();
    // v0.5.2.3 — post-save lands on the printable label.
    await expect(page.getByTestId('label-screen')).toBeVisible();
    await page.getByTestId('label-done').click();
    await page.goto('/');
    await expect(page.getByTestId('search-screen')).toBeVisible();

    await page.reload();
    await page.getByTestId('search-input').fill('Persistence');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    await page.getByTestId('result-card').first().click();
    await expect(page.getByTestId('detail-bar')).toBeVisible();

    // Hero photo present; rendered from a Blob URL (no network).
    const heroSrc = await page
      .getByTestId('hero-photo-img')
      .locator('img')
      .first()
      .getAttribute('src');
    expect(heroSrc).toMatch(/^blob:/);

    // ADR-008: photo bytes must be ≤ 200 KB after compression.
    const photos = await page.evaluate(async () => {
      return new Promise<Array<{ bytes: number; mime: string }>>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const database = req.result;
          const tx = database.transaction('photos', 'readonly');
          const store = tx.objectStore('photos');
          const all = store.getAll();
          all.onsuccess = () => {
            const rows = all.result as Array<{ bytes: number; mime: string }>;
            resolve(rows.map((p) => ({ bytes: p.bytes, mime: p.mime })));
            database.close();
          };
        };
      });
    });
    expect(photos).toHaveLength(1);
    expect(photos[0]?.bytes).toBeLessThanOrEqual(200 * 1024);
    expect(photos[0]?.mime).toMatch(/^image\//);
  });

  test('persistence flag is requested on first launch (post-onboarding)', async ({ page }) => {
    const persisted = await page.evaluate(async () => {
      return new Promise<boolean>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const database = req.result;
          const tx = database.transaction('meta', 'readonly');
          const store = tx.objectStore('meta');
          const get = store.get('persistence_requested');
          get.onsuccess = () => {
            const row = get.result as { value: unknown } | undefined;
            resolve(Boolean(row?.value));
            database.close();
          };
        };
      });
    });
    expect(persisted).toBe(true);
  });

  test('article survives reload', async ({ page }) => {
    // Seed an article via the test surface to keep this test independent of
    // the photo upload path (which is its own test above).
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Persistence Shop',
        locale: 'fr',
        articles: [
          {
            name: 'Reload survivor',
            colors: ['white'],
            sizes: [{ size: '42', qty: 3 }],
            cost_tnd: 40_000,
            sale_tnd: 70_000,
          },
        ],
      });
    });
    await page.reload();
    await page.getByTestId('search-input').fill('reload');
    await expect(page.getByTestId('result-card')).toHaveCount(1);
    await expect(page.getByText('Reload survivor')).toBeVisible();
  });
});
