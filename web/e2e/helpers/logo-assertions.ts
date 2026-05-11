import { type Page, expect } from '@playwright/test';

// v0.5.4 ADR-028 — inspect the stored logo by walking the rendered
// Settings preview <img> back to its underlying Blob. We can't reach
// IndexedDB directly from Playwright, but the PhotoThumb component
// renders an <img src> backed by `URL.createObjectURL(photoToBlob(...))`,
// so fetching that URL inside the page recovers the exact bytes the
// repo persisted.

export interface StoredLogoInfo {
  mime: string;
  width: number;
  height: number;
  alphaZero: number;
  alphaFull: number;
  alphaPartial: number;
  totalPixels: number;
  cornerAlpha: number;
}

export async function readStoredLogo(page: Page): Promise<StoredLogoInfo> {
  const img = page.locator('[data-testid="shop-logo-preview"] img');
  await expect(img).toBeVisible({ timeout: 10_000 });
  return page.evaluate(async () => {
    const node = document.querySelector('[data-testid="shop-logo-preview"] img');
    if (!(node instanceof HTMLImageElement)) {
      throw new Error('shop-logo-preview <img> not found');
    }
    const res = await fetch(node.src);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    // Capture dimensions BEFORE close — once closed, ImageBitmap
    // detaches and width/height read back as 0.
    const width = bitmap.width;
    const height = bitmap.height;
    const { data } = ctx.getImageData(0, 0, width, height);
    let alphaZero = 0;
    let alphaFull = 0;
    let alphaPartial = 0;
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      if (a === 0) alphaZero += 1;
      else if (a === 255) alphaFull += 1;
      else alphaPartial += 1;
    }
    // Corner pixel = 1px inset from top-left, same convention the
    // production keyer uses for its uniform-bg sampling.
    const cornerIdx = (1 * width + 1) * 4 + 3;
    const cornerAlpha = data[cornerIdx] ?? 255;
    bitmap.close?.();
    return {
      mime: blob.type,
      width,
      height,
      alphaZero,
      alphaFull,
      alphaPartial,
      totalPixels: width * height,
      cornerAlpha,
    };
  });
}
