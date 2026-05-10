import { expect, test } from '@playwright/test';
import { onboardViaUI } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.3 (ADR-011) + v0.5 (ADR-017): the Add Article flow renders no colour
// picker and no per-size split when the active store_type has
// has_colors=false (shop). The single block exposes a Floor + Back stepper
// instead of the colour × size grid. The resulting Variant ends up with
// color=null AND size=null — uniform storage shape regardless of vertical.

test.describe('Add Article — sizeless, colourless verticals (shop)', () => {
  test('shop: no colour picker, no size rows, single floor/back input', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('intent-new').click();
    await page.getByTestId('onb-store-shop').click();
    await page.getByTestId('shop-name-input').fill('Mini Mart');
    await page.getByTestId('continue').click();
    await page.getByTestId('got-it').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    void onboardViaUI; // type-check the import — kept for parity with sibling tests

    await page.getByTestId('nav-add').click();
    await expect(page.getByTestId('step-1')).toBeVisible();

    // Step 1 — basics. The category list is the shop fallback one
    // (commit 2 will replace it with the union of selected sub-types).
    await page.getByTestId('field-name').fill('Spaghetti');
    await page.getByTestId('field-cost').fill('5');
    await page.getByTestId('field-sale').fill('7');
    await page.getByTestId('continue').click();

    // Step 2 — sizeless: colour chips are absent, the size table is
    // absent, the sizeless floor/back stepper pair is present.
    await expect(page.getByTestId('block-0')).toBeVisible();
    await expect(page.getByTestId('block-0-color-chips')).toHaveCount(0);
    await expect(page.getByTestId('block-0-size-0-input')).toHaveCount(0);
    await expect(page.getByTestId('block-0-sizeless')).toBeVisible();
    // Add-another-colour shouldn't render either.
    await expect(page.getByTestId('add-color-block')).toHaveCount(0);

    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    // Stepper-driven back stock: the sizeless block exposes block-0-back
    // (no size suffix because there's only one row). Tap +1 twelve times.
    for (let i = 0; i < 12; i += 1) {
      await page.getByTestId('block-0-back-plus').click();
    }

    await page.getByTestId('save').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    type V = {
      color: string | null;
      size: string | null;
      deleted_at: string | null;
    };
    type M = {
      delta: number;
      type: string;
      location: 'floor' | 'back' | null;
    };
    const state = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['variants', 'movements'], 'readonly');
      const variants = await new Promise<unknown[]>((resolve, reject) => {
        const r = tx.objectStore('variants').getAll();
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
      const movements = await new Promise<unknown[]>((resolve, reject) => {
        const r = tx.objectStore('movements').getAll();
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return { variants, movements };
    });

    const variants = state.variants as V[];
    const movements = state.movements as M[];
    const alive = variants.filter((v) => v.deleted_at === null);
    expect(alive.length).toBe(1);
    expect(alive[0]?.color).toBeNull();
    expect(alive[0]?.size).toBeNull();
    expect(movements.length).toBe(1);
    expect(movements[0]?.location).toBe('back');
    expect(movements[0]?.delta).toBe(12);
  });
});
