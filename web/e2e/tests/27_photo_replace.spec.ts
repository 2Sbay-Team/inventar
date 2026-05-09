import { expect, test } from '@playwright/test';
import { onboardViaSeed } from '../helpers/onboarding';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE = path.resolve(__dirname, '../fixtures/photos/sample.png');

// User-reported gap: "if the article photo is bad, can I change it?"
// This proves the camera button on article-detail actually swaps the photo.

test.describe('Article photo replacement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await onboardViaSeed(page, { lang: 'en', shopName: 'Photo Shop' });
    await page.reload();

    // Seed one article with a 1x1 GIF as its initial photo so we have
    // something to *replace* (not just add). photoB64 is the 1x1 transparent
    // GIF — smallest valid image.
    await page.evaluate(async () => {
      await window.__inventarSeed!.seed({
        shopName: 'Photo Shop',
        locale: 'en',
        reset: false,
        articles: [
          {
            name: 'Replaceable shoe',
            colors: ['white'],
            sizes: [{ size: '42', qty: 3 }],
            photoB64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        ],
      });
    });
    await page.reload();
  });

  test('camera button on hero photo replaces the image and soft-deletes the old one', async ({
    page,
  }) => {
    await page.getByTestId('search-input').fill('replaceable');
    await page.getByTestId('result-card').first().click();
    await expect(page.getByTestId('hero-photo-img')).toBeVisible();
    await expect(page.getByTestId('hero-photo-change')).toBeEnabled();

    // Capture the original photo_id from IndexedDB so we can later assert
    // it was soft-deleted (not hard-deleted, not left intact).
    const before = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['articles', 'photos'], 'readonly');
      const articles = await new Promise<Array<{ photo_id: string | null; name: string }>>(
        (resolve, reject) => {
          const req = tx.objectStore('articles').getAll();
          req.onsuccess = () =>
            resolve(req.result as Array<{ photo_id: string | null; name: string }>);
          req.onerror = () => reject(req.error);
        },
      );
      const photos = await new Promise<Array<{ id: string; deleted_at: string | null }>>(
        (resolve, reject) => {
          const req = tx.objectStore('photos').getAll();
          req.onsuccess = () =>
            resolve(req.result as Array<{ id: string; deleted_at: string | null }>);
          req.onerror = () => reject(req.error);
        },
      );
      db.close();
      const target = articles.find((a) => a.name === 'Replaceable shoe')!;
      return { articlePhotoId: target.photo_id, photos };
    });
    expect(before.articlePhotoId).not.toBeNull();
    expect(before.photos.find((p) => p.id === before.articlePhotoId)?.deleted_at).toBeNull();

    // Replace via the new camera button. The button shows "Saving…" while
    // compressPhoto + storePhoto + updateArticle are in flight, then flips
    // back to "Take new photo" when handleNewPhoto's finally block resets
    // photoBusy. Waiting on that state-machine transition is the strongest
    // signal that the entire pipeline finished without throwing.
    await page.setInputFiles('[data-testid="hero-photo-input"]', SAMPLE);
    await expect(page.getByTestId('hero-photo-change')).toContainText(/Take new photo/i, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('hero-photo-change')).toBeEnabled();

    const after = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('inventar');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction(['articles', 'photos'], 'readonly');
      const articles = await new Promise<Array<{ photo_id: string | null; name: string }>>(
        (resolve, reject) => {
          const req = tx.objectStore('articles').getAll();
          req.onsuccess = () =>
            resolve(req.result as Array<{ photo_id: string | null; name: string }>);
          req.onerror = () => reject(req.error);
        },
      );
      const photos = await new Promise<
        Array<{ id: string; deleted_at: string | null; bytes: number }>
      >((resolve, reject) => {
        const req = tx.objectStore('photos').getAll();
        req.onsuccess = () =>
          resolve(req.result as Array<{ id: string; deleted_at: string | null; bytes: number }>);
        req.onerror = () => reject(req.error);
      });
      db.close();
      const target = articles.find((a) => a.name === 'Replaceable shoe')!;
      return { articlePhotoId: target.photo_id, photos };
    });

    // 1) Article now points at a different (new) photo.
    expect(after.articlePhotoId).not.toBe(before.articlePhotoId);
    expect(after.articlePhotoId).not.toBeNull();

    // 2) New photo row exists, alive, with non-zero bytes.
    const newPhoto = after.photos.find((p) => p.id === after.articlePhotoId);
    expect(newPhoto).toBeDefined();
    expect(newPhoto?.deleted_at).toBeNull();
    expect(newPhoto!.bytes).toBeGreaterThan(0);

    // 3) Old photo soft-deleted (still in the table for in-flight backups,
    //    but tombstoned so getPhoto() returns undefined).
    const oldPhoto = after.photos.find((p) => p.id === before.articlePhotoId);
    expect(oldPhoto, 'old photo row must still exist (soft delete only)').toBeDefined();
    expect(oldPhoto?.deleted_at).not.toBeNull();

    // 4) The hero img src is a fresh Blob URL (re-rendered from the new row).
    const heroSrc = await page
      .getByTestId('hero-photo-img')
      .locator('img')
      .first()
      .getAttribute('src');
    expect(heroSrc).toMatch(/^blob:/);
  });
});
