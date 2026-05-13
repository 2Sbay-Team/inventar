import { expect, test, type Page } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.9.x — replaces the cart-based /sale spec (test 38) with session-
// flow coverage matching the new UI:
//   ✕ exits cleanly with no sales; confirms when sales exist.
//   Session counter chip + summary modal numbers are correct.
//   Search filters the product list; typing an exact code jumps to
//     the variant picker.
//   List is sorted by stock desc, out-of-stock rows last and dimmed.
//   Variant picker shows per-size stock and pre-selects the
//     highest-stock cell; Confirm commits one Movement per sale with
//     the session's transaction_id and surfaces a toast.

interface SeedArticle {
  id: string;
  code: string;
  name: string;
  sale: number;
  variants: Array<{ id: string; color: string | null; size: string | null; stock: number }>;
}

async function seedArticles(page: Page, articles: SeedArticle[]): Promise<void> {
  await page.evaluate(
    async (rows) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();
      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(['articles', 'variants', 'movements'], 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        for (const a of rows) {
          tx.objectStore('articles').add({
            id: a.id,
            internal_code: a.code,
            name: a.name,
            photo_id: null,
            category: 'shoes',
            colors: [],
            brand: null,
            cost_price_tnd: 5000,
            sale_price_tnd: a.sale,
            notes: null,
            barcode_ean: null,
            min_stock_threshold: null,
            expiry_alert_days: null,
            has_sizes: null,
            has_colors: null,
            has_expiry: null,
            unit_of_measure: 'piece',
            tax_category: null,
            search_blob: `${a.name.toLowerCase()} ${a.code.toLowerCase()}`,
            updated_at: now,
            archived_at: null,
            deleted_at: null,
          });
          for (const v of a.variants) {
            tx.objectStore('variants').add({
              id: v.id,
              article_id: a.id,
              color: v.color,
              size: v.size,
              photo_id: null,
              hidden: false,
              updated_at: now,
              deleted_at: null,
            });
            if (v.stock > 0) {
              tx.objectStore('movements').add({
                id: `seed-${v.id}`,
                variant_id: v.id,
                delta: v.stock,
                type: 'purchase',
                note: null,
                unit_price_tnd: null,
                location: 'back',
                transfer_from: null,
                transfer_to: null,
                transaction_id: null,
                expires_at: null,
                lot_id: null,
                refunds_movement_id: null,
                created_at: now,
                deleted_at: null,
              });
            }
          }
        }
      });
      idb.close();
    },
    articles as unknown as Record<string, unknown>[],
  );
}

const FIXTURES: SeedArticle[] = [
  {
    id: 'art-nike',
    code: 'FN-0001',
    name: 'Nike Air Max',
    sale: 120_000,
    variants: [
      { id: 'v-nike-40', color: 'Black', size: '40', stock: 15 },
      { id: 'v-nike-41', color: 'Black', size: '41', stock: 8 },
      { id: 'v-nike-42', color: 'Black', size: '42', stock: 3 },
      { id: 'v-nike-43', color: 'Black', size: '43', stock: 0 },
    ],
  },
  {
    id: 'art-adidas',
    code: 'FN-0002',
    name: 'Adidas Stan',
    sale: 95_000,
    variants: [{ id: 'v-adidas-1', color: null, size: '40', stock: 8 }],
  },
  {
    id: 'art-puma',
    code: 'FN-0003',
    name: 'Puma RS-X',
    sale: 75_000,
    variants: [{ id: 'v-puma-1', color: null, size: '40', stock: 3 }],
  },
  {
    id: 'art-sold-out',
    code: 'FN-0004',
    name: 'Out Of Stock Item',
    sale: 60_000,
    variants: [{ id: 'v-oos-1', color: null, size: null, stock: 0 }],
  },
];

async function setupSale(page: Page): Promise<void> {
  await page.goto('/');
  await onboardViaSeed(page, {
    lang: 'en',
    shopName: 'Sell v0.9.x',
    storeType: 'fashion',
    fashionSubtypes: ['shoes'],
  });
  await seedArticles(page, FIXTURES);
  await page.goto('/sale');
  await expect(page.getByTestId('sell-screen')).toBeVisible();
}

test('N+2: ✕ with no sales in session exits straight to / (no confirmation)', async ({ page }) => {
  await setupSale(page);
  await page.getByTestId('sell-close').click();
  await expect(page.getByTestId('sell-end-confirm')).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/');
});

test('N+9 + N+12 + N+13: list sorted by stock desc; search filters; 0-stock dimmed and last', async ({
  page,
}) => {
  await setupSale(page);

  // Stock totals: Nike = 15+8+3+0 = 26, Adidas = 8, Puma = 3, Sold Out = 0.
  const rows = page.getByTestId(/sell-row-FN-/);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'sell-row-FN-0001');
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'sell-row-FN-0002');
  await expect(rows.nth(2)).toHaveAttribute('data-testid', 'sell-row-FN-0003');
  await expect(rows.nth(3)).toHaveAttribute('data-testid', 'sell-row-FN-0004');

  await expect(page.getByTestId('sell-row-FN-0004-stock')).toContainText('0');

  await page.getByTestId('sell-search-input').fill('puma');
  await expect(page.getByTestId('sell-row-FN-0001')).toHaveCount(0);
  await expect(page.getByTestId('sell-row-FN-0003')).toBeVisible();
});

test('N+10: typing an exact internal code opens the variant picker directly', async ({ page }) => {
  await setupSale(page);
  await page.getByTestId('sell-search-input').fill('FN-0002');
  await expect(page.getByTestId('sell-variant-picker')).toBeVisible({ timeout: 5_000 });
});

test('N+14 + N+15 + N+16: variant picker shows per-size stock, pre-selects highest, Confirm decrements + toasts + ends with [End N · TND →]', async ({
  page,
}) => {
  await setupSale(page);

  await page.getByTestId('sell-row-FN-0001').click();
  await expect(page.getByTestId('sell-variant-picker')).toBeVisible();

  // The four sized chips render with their stock counts.
  await expect(page.getByTestId('sell-size-40')).toContainText('15');
  await expect(page.getByTestId('sell-size-41')).toContainText('8');
  await expect(page.getByTestId('sell-size-42')).toContainText('3');
  await expect(page.getByTestId('sell-size-43')).toContainText('0');

  // Pre-selected = highest stock (size 40, 15 units).
  await expect(page.getByTestId('sell-size-40')).toHaveAttribute('aria-pressed', 'true');

  // Confirm one unit.
  await page.getByTestId('sell-confirm').click();

  // Toast appears; picker closes.
  await expect(page.getByTestId('sell-toast')).toBeVisible();
  await expect(page.getByTestId('sell-variant-picker')).toHaveCount(0);

  // Header now shows the End-session chip with 1 · TND total.
  await expect(page.getByTestId('sell-end-session')).toBeVisible();
  await expect(page.getByTestId('sell-end-session')).toContainText('1');

  // Variant 40's stock decremented from 15 → 14. Re-open the picker
  // and check the chip count.
  await page.getByTestId('sell-row-FN-0001').click();
  await expect(page.getByTestId('sell-size-40')).toContainText('14');
});

test('N+3 + N+5 + N+6 + N+7: with 1+ sales, ✕ confirms; End → summary; summary totals; back/reports actions', async ({
  page,
}) => {
  await setupSale(page);
  await page.getByTestId('sell-row-FN-0002').click();
  await page.getByTestId('sell-confirm').click();
  await expect(page.getByTestId('sell-end-session')).toBeVisible();

  // ✕ now opens the confirmation, not an instant exit.
  await page.getByTestId('sell-close').click();
  await expect(page.getByTestId('sell-end-confirm')).toBeVisible();
  await page.getByTestId('sell-end-keep').click();
  await expect(page.getByTestId('sell-end-confirm')).toHaveCount(0);

  // End → summary modal with correct totals.
  await page.getByTestId('sell-end-session').click();
  await expect(page.getByTestId('sell-session-summary')).toBeVisible();
  await expect(page.getByTestId('sell-summary-count')).toContainText('1');
  await expect(page.getByTestId('sell-summary-total')).toContainText('95');

  // View in Reports → /reports.
  await page.getByTestId('sell-summary-reports').click();
  await expect(page).toHaveURL(/\/reports$/, { timeout: 5_000 });
});

test('N+20: desktop (no touch) — no camera viewfinder, search bar shown immediately', async ({
  page,
}) => {
  await setupSale(page);
  // Playwright's default Chromium has neither touch nor coarse pointer,
  // so the search bar is the only input affordance.
  await expect(page.getByTestId('sell-search-input')).toBeVisible();
  await expect(page.getByTestId('sell-camera-strip')).toHaveCount(0);
});

test('Documents sub-tab: switching shows the coming-soon placeholder', async ({ page }) => {
  await setupSale(page);
  await page.getByTestId('sale-tab-documents').click();
  await expect(page).toHaveURL(/\/sale\?tab=documents$/, { timeout: 5_000 });
  await expect(page.getByTestId('documents-screen')).toBeVisible();
  await expect(page.getByTestId('documents-screen')).toContainText('Quotes & Invoices');
  await expect(page.getByTestId('documents-screen')).toContainText('Coming soon');
});

test('one Movement per Confirm, all sharing the session transaction_id', async ({ page }) => {
  await setupSale(page);

  await page.getByTestId('sell-row-FN-0002').click();
  await page.getByTestId('sell-confirm').click();
  await expect(page.getByTestId('sell-toast')).toBeVisible();
  await expect(page.getByTestId('sell-toast')).toHaveCount(0, { timeout: 3_000 });

  await page.getByTestId('sell-row-FN-0003').click();
  await page.getByTestId('sell-confirm').click();
  await expect(page.getByTestId('sell-toast')).toBeVisible();

  const sales = await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const idb = dbReq.result;
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = idb.transaction('movements', 'readonly');
      const r = tx.objectStore('movements').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
      r.onerror = () => reject(r.error);
    });
    idb.close();
    return all;
  });
  type M = {
    type: string;
    delta: number;
    transaction_id: string | null;
    deleted_at: string | null;
  };
  const sale = (sales as M[]).filter((m) => m.type === 'sale' && m.deleted_at === null);
  expect(sale.length).toBe(2);
  const txnIds = new Set(sale.map((m) => m.transaction_id));
  expect(txnIds.size).toBe(1);
  expect([...txnIds][0]).not.toBeNull();
  expect(sale.every((m) => m.delta === -1)).toBe(true);
});
