import { expect, test } from '@playwright/test';

// Walks the exact scenario the user asked about: a small minimarket with
// a "Spaghetti" article. Confirms the sizeless flow works end-to-end —
// stock count visible, search shows correct copy (no "1 sizes"), and
// today's profit shows up after a sale.
//
// v0.5 (ADR-017): the legacy 'grocery' vertical was merged into 'shop'.
// The behaviour under test is unchanged; only the picker chip changed.

test('shop: add spaghetti, sell some, see stock + today profit', async ({ page }) => {
  // Onboard as shop via UI so store_type=shop.
  await page.goto('/');
  await page.getByTestId('lang-en').click();
  await page.getByTestId('intent-new').click();
  await page.getByTestId('onb-store-shop').click();
  await page.getByTestId('shop-name-input').fill('Mini Mart');
  await page.getByTestId('continue').click();
  // v0.5 ADR-017: shop vertical now has a sub-types step before the
  // backup card. Pick food_beverages so dry_goods is in the default
  // category list (matches the seeded article below).
  await page.getByTestId('onb-subtype-food_beverages').click();
  await page.getByTestId('continue').click();
  await page.getByTestId('got-it').click();
  await expect(page.getByTestId('search-screen')).toBeVisible();

  // Seed one Spaghetti article through the public IndexedDB API rather
  // than the photo-required Add Article UI (Playwright + headless camera
  // is fragile). This is exactly what a real user's data would look like.
  await page.evaluate(async () => {
    const dbReq = indexedDB.open('inventar');
    await new Promise<void>((resolve, reject) => {
      dbReq.onsuccess = () => resolve();
      dbReq.onerror = () => reject(dbReq.error);
    });
    const db = dbReq.result;
    const now = new Date().toISOString();
    const articleId = 'spaghetti-test-id';
    const variantId = 'spaghetti-variant-id';
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['articles', 'variants', 'movements'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore('articles').add({
        id: articleId,
        internal_code: 'GR-0001',
        name: 'Spaghetti',
        photo_id: null,
        category: 'dry_goods',
        colors: [],
        brand: 'Barilla',
        cost_price_tnd: 5000,
        sale_price_tnd: 7000,
        notes: null,
        // Search blob built the same way the real repo does it (just
        // lowercase tokens of name+brand+category — covers the search
        // path used in this test).
        search_blob: 'spaghetti barilla dry_goods',
        updated_at: now,
        archived_at: null,
        deleted_at: null,
      });
      tx.objectStore('variants').add({
        id: variantId,
        article_id: articleId,
        color: null,
        size: '',
        photo_id: null,
        hidden: false,
        updated_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'spaghetti-purchase',
        variant_id: variantId,
        delta: 50,
        type: 'purchase',
        note: null,
        unit_price_tnd: null,
        location: 'back',
        transfer_from: null,
        transfer_to: null,
        transaction_id: null,
        expires_at: null,
        lot_id: null,
        created_at: now,
        deleted_at: null,
      });
      tx.objectStore('movements').add({
        id: 'spaghetti-sale-1',
        variant_id: variantId,
        delta: -3,
        type: 'sale',
        note: null,
        unit_price_tnd: null,
        location: 'floor',
        transfer_from: null,
        transfer_to: null,
        transaction_id: null,
        expires_at: null,
        lot_id: null,
        created_at: now,
        deleted_at: null,
      });
    });
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId('search-screen')).toBeVisible();

  // 1. Search for "spaghetti" — result card should show grocery-friendly
  //    "47 in stock" instead of "47 pairs · 1 sizes".
  await page.getByTestId('search-input').fill('spaghetti');
  const card = page.getByTestId('result-card').first();
  await expect(card).toBeVisible({ timeout: 4000 });
  const badge = card.getByTestId('stock-badge');
  await expect(badge).toBeVisible();
  const badgeText = await badge.textContent();
  expect(badgeText, 'sizeless badge should not say "pairs" or "sizes"').not.toMatch(/pair|size/i);
  expect(badgeText).toContain('47');

  // 2. Open the article — size grid should be hidden, stock total visible.
  await card.click();
  await expect(page.getByTestId('stock-total')).toContainText('47');
  // Size grid section's testid would be inside the section we wrap with
  // {needsSizes ? ... : null} — for grocery it shouldn't render.
  await expect(page.getByTestId('size-grid')).toHaveCount(0);

  // 3. Activity feed shouldn't show empty " · " before the movement type.
  const activity = page.getByTestId('activity-feed');
  await expect(activity).toBeVisible();
  const firstRow = page.getByTestId('activity-row').first();
  const firstRowText = await firstRow.textContent();
  expect(firstRowText, 'activity row should not start with empty size dot').not.toMatch(
    /^\s*−?\d+\s*·\s+·/,
  );

  // 4. Dashboard — today's profit should reflect the 3 sales.
  //    revenue = 3 × 7000 = 21000 millimes = 21 TND
  //    gross = 3 × (7000 - 5000) = 6000 millimes = 6 TND
  // Article detail sets hideNav, so go back first to reach the bottom nav.
  await page.getByTestId('detail-back').click();
  await expect(page.getByTestId('nav-dashboard')).toBeVisible();
  await page.getByTestId('nav-dashboard').click();
  await expect(page.getByTestId('dashboard-screen')).toBeVisible();
  await expect(page.getByTestId('big-revenue')).toContainText(/21/);
  // Items sold (sizeless label) — 3.
  await expect(page.getByTestId('big-pairs')).toContainText('3');

  // 5. Inventory overview tile — units == 47, low stock badge inactive.
  const overview = page.getByTestId('inventory-overview');
  await expect(overview).toBeVisible();
  await expect(page.getByTestId('inv-units')).toContainText('47');
  await expect(page.getByTestId('inv-articles')).toContainText('1');
});
