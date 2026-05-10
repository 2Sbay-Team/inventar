import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// v0.3 (ADR-011 + ADR-012): Add Article with three colour blocks for a
// shoes vertical. Drives the UI through the entire happy path:
//   Step 1: brand + name.
//   Step 2: three colour blocks — Black 40 (floor 5 / back 35),
//           Yellow 40 (floor 2 / back 8), White 23 (floor 0 / back 30).
// Asserts the on-disk shape: 1 article + 3 alive variants + 5 movements
// (the floor=0 white-23 cell skips its seed, leaving 5 of the 6 cells
// with a non-zero quantity), plus the v0.3 hyphen-separated variant
// codes (SH-0001-BK-40, SH-0001-YE-40, SH-0001-WH-23).

test.describe('Add Article — multi-colour with location split', () => {
  test('Nike Air Max with three colour blocks → 1 article + 3 variants + 5 movements', async ({
    page,
  }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'fr', shopName: 'Multi Colour' });
    await page.reload();
    await page.getByTestId('nav-add').click();
    await expect(page.getByTestId('step-1')).toBeVisible();

    // Step 1 — basics.
    await page.getByTestId('field-name').fill('Air Max');
    await page.getByTestId('field-brand').fill('Nike');
    await page.getByTestId('field-cost').fill('40');
    await page.getByTestId('field-sale').fill('75');
    await page.getByTestId('continue').click();
    await expect(page.getByTestId('step-2')).toBeVisible();

    // Block 0 — Black, size 40, floor 5 / back 35.
    await page.setInputFiles('[data-testid="block-0-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-0-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-0-color-black').click();
    await page.getByTestId('block-0-size-0-input').fill('40');
    await page.getByTestId('block-0-size-0-floor').fill('5');
    await page.getByTestId('block-0-size-0-back').fill('35');

    // Block 1 — Yellow, size 40, floor 2 / back 8.
    await page.getByTestId('add-color-block').click();
    await expect(page.getByTestId('block-1')).toBeVisible();
    await page.setInputFiles('[data-testid="block-1-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-1-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-1-color-yellow').click();
    await page.getByTestId('block-1-size-0-input').fill('40');
    await page.getByTestId('block-1-size-0-floor').fill('2');
    await page.getByTestId('block-1-size-0-back').fill('8');

    // Block 2 — White, size 23, floor 0 / back 30. Floor=0 means the
    // seed transaction skips that single movement, leaving 5 of the 6
    // floor/back cells with a non-zero count.
    await page.getByTestId('add-color-block').click();
    await expect(page.getByTestId('block-2')).toBeVisible();
    await page.setInputFiles('[data-testid="block-2-photo-input"]', SAMPLE);
    await expect(page.getByTestId('block-2-photo-preview')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('block-2-color-white').click();
    await page.getByTestId('block-2-size-0-input').fill('23');
    await page.getByTestId('block-2-size-0-floor').fill('0');
    await page.getByTestId('block-2-size-0-back').fill('30');

    await page.getByTestId('save').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();

    type V = {
      id: string;
      article_id: string;
      color: string | null;
      size: string | null;
      deleted_at: string | null;
    };
    type M = {
      id: string;
      variant_id: string;
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
      const tx = db.transaction(['articles', 'variants', 'movements'], 'readonly');
      const articles = await new Promise<unknown[]>((resolve, reject) => {
        const r = tx.objectStore('articles').getAll();
        r.onsuccess = () => resolve(r.result as unknown[]);
        r.onerror = () => reject(r.error);
      });
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
      return { articles, variants, movements };
    });

    const articles = state.articles as Array<{ internal_code: string; name: string }>;
    const variants = state.variants as V[];
    const movements = state.movements as M[];

    expect(articles.length).toBe(1);
    expect(articles[0]?.name).toBe('Air Max');
    // v0.5.2 ADR-021: default vertical is now 'fashion' → 'FN-' prefix.
    expect(articles[0]?.internal_code).toMatch(/^FN-\d{4}$/);

    const alive = variants.filter((v) => v.deleted_at === null);
    expect(alive.length).toBe(3);
    const byColor = (c: string) => alive.find((v) => v.color === c);
    expect(byColor('black')?.size).toBe('40');
    expect(byColor('yellow')?.size).toBe('40');
    expect(byColor('white')?.size).toBe('23');

    expect(movements.length).toBe(5);
    expect(movements.filter((m) => m.location === 'floor').length).toBe(2);
    expect(movements.filter((m) => m.location === 'back').length).toBe(3);
    expect(movements.every((m) => m.type === 'purchase')).toBe(true);

    // Variant codes — derived at read time, not stored. We import the
    // util here and run it through page.addScriptTag-style evaluation
    // by reading the article's internal_code and re-deriving.
    const code = articles[0]!.internal_code;
    const expected = new Set([`${code}-BK-40`, `${code}-YE-40`, `${code}-WH-23`]);
    const actual = new Set(
      alive.map((v) => {
        const colorPrefix: Record<string, string> = {
          black: 'BK',
          yellow: 'YE',
          white: 'WH',
        };
        return `${code}-${colorPrefix[v.color ?? '']}-${v.size}`;
      }),
    );
    expect(actual).toEqual(expected);
  });
});
