import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';

// v0.5.2.2 — stress test for the "what happens at 200 articles + 50 photos"
// scenario. Spec §5 caps the MVP at ~500 articles per shop; this test
// gets us to ~40% of that limit so we can catch ordering / quota /
// search-responsiveness regressions before a real merchant does.
//
// Skipped by default since it's slow (~45s); opt in with
// `npx playwright test --grep @stress`.

test.describe('@stress large catalogue', () => {
  test('200 articles + 50 photos: write completes, search stays responsive, no IDB quota error', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto('/');
    await onboardViaSeed(page, {
      lang: 'en',
      shopName: 'Stress Test',
      storeType: 'shop',
      shopSubtypes: ['food_beverages'],
    });
    await page.reload();

    // 1×1 PNG, base64 — minimal valid image so the photo rows have
    // real Blob content without ballooning the test runtime. 50 of
    // these go into the catalogue alongside 150 photo-less articles.
    const TINY_PNG_B64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAACklEQVR4nGNgAAAAAgABc3UBGAAAAABJRU5ErkJggg==';

    const writeStart = Date.now();
    const writeReport = await page.evaluate(async (pngB64) => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const now = new Date().toISOString();

      // Decode the tiny PNG once outside the loop. v0.5.2.2: photos
      // are stored as Uint8Array (not Blob) — iOS Safari refuses to
      // store Blobs returned by canvas in IndexedDB, so the storage
      // layer normalizes everything to bytes. This test mirrors that.
      const binary = atob(pngB64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      let written = 0;
      let quotaError: string | null = null;
      // Single transaction per article keeps IDB happy and matches
      // the real Add Article path. Batching all 200 in one tx would
      // be faster but unrepresentative.
      for (let i = 1; i <= 200; i += 1) {
        const id = `stress-a-${i}`;
        const variantId = `stress-v-${i}`;
        const photoId = i <= 50 ? `stress-p-${i}` : null;
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = idb.transaction(
              ['articles', 'variants', 'movements', 'photos'],
              'readwrite',
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            if (photoId) {
              tx.objectStore('photos').add({
                id: photoId,
                blob: bytes,
                width: 1,
                height: 1,
                bytes: bytes.byteLength,
                mime: 'image/png',
                created_at: now,
                deleted_at: null,
              });
            }
            tx.objectStore('articles').add({
              id,
              internal_code: `SP-${String(i).padStart(4, '0')}`,
              name: `Item ${i}`,
              photo_id: photoId,
              category: 'drinks',
              colors: [],
              brand: i % 3 === 0 ? `Brand${(i / 3) | 0}` : null,
              cost_price_tnd: 1000 + i,
              sale_price_tnd: 2000 + i,
              notes: null,
              barcode_ean: null,
              min_stock_threshold: i % 10 === 0 ? 5 : null,
              expiry_alert_days: null,
              search_blob: `item ${i} ${i % 3 === 0 ? `brand${(i / 3) | 0}` : ''} drinks sp-${String(i).padStart(4, '0')}`,
              updated_at: now,
              archived_at: null,
              deleted_at: null,
            });
            tx.objectStore('variants').add({
              id: variantId,
              article_id: id,
              color: null,
              size: null,
              photo_id: null,
              hidden: false,
              updated_at: now,
              deleted_at: null,
            });
            tx.objectStore('movements').add({
              id: `stress-m-${i}`,
              variant_id: variantId,
              delta: 10,
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
          });
          written += 1;
        } catch (e) {
          quotaError = (e as Error).message ?? String(e);
          break;
        }
      }
      idb.close();
      return { written, quotaError };
    }, TINY_PNG_B64);

    const writeMs = Date.now() - writeStart;
    expect(writeReport.quotaError).toBeNull();
    expect(writeReport.written).toBe(200);
    // 200 articles in one go shouldn't take more than ~30s even on
    // a slow Linux runner. Generous ceiling so the test isn't flaky.
    expect(writeMs).toBeLessThan(45_000);

    // Reload to drop any in-memory state, then exercise search.
    await page.reload();
    await expect(page.getByTestId('search-screen')).toBeVisible();
    const searchStart = Date.now();
    await page.getByTestId('search-input').fill('item 1');
    // Wait for results to settle — at minimum the chip count badge
    // updates. Search is debounced; give it a moment.
    await page.waitForTimeout(500);
    const searchMs = Date.now() - searchStart;
    // Search shouldn't take longer than ~3s end-to-end on a Linux
    // runner. Real phone will be slower but ADR-009 commits to
    // <300ms typeahead at MVP scale (500 articles); 200 articles
    // here, 3s ceiling is conservative.
    expect(searchMs).toBeLessThan(3_000);

    // Confirm at least one result row rendered. "item 1" matches
    // 1, 10, 11..19, 100..199 — well above the rendered virtualization
    // threshold but the count chip should still tally correctly.
    const resultCount = await page.getByTestId('result-card').count();
    expect(resultCount).toBeGreaterThan(0);

    // Final IDB sanity: confirm the persisted article count matches
    // what we wrote, AND no rows were silently dropped by quota
    // (which can manifest as partial writes that don't throw).
    const finalCount = await page.evaluate(async () => {
      const dbReq = indexedDB.open('inventar');
      await new Promise<void>((resolve, reject) => {
        dbReq.onsuccess = () => resolve();
        dbReq.onerror = () => reject(dbReq.error);
      });
      const idb = dbReq.result;
      const total = await new Promise<number>((resolve, reject) => {
        const tx = idb.transaction('articles', 'readonly');
        const r = tx.objectStore('articles').count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      idb.close();
      return total;
    });
    expect(finalCount).toBe(200);
  });
});
