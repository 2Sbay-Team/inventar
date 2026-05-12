// v0.9 ADR-042 — Async wrapper that decodes a logo Blob to RGBA pixels
// and runs the pure extractor (extract-logo-color.ts). Lives in its
// own module because it needs canvas access (browser-only) while the
// pure extractor stays node-testable.
//
// Performance note: we cap the canvas at 256x256 before reading pixels.
// The histogram converges with far fewer samples than the original
// 800x800 logo carries — chrome.getImageData() on a 256x256 canvas
// is ~10x faster than 800x800 on real devices, and the dominant
// colour result is unchanged within the 5-bit bucket resolution.

import { createKeyingCanvas } from '../utils/logo-transparency';
import { extractDominantColor, type PixelBuffer } from './extract-logo-color';

const SAMPLE_MAX_DIMENSION = 256;

// Returns the logo's dominant hex colour, or null if no usable brand
// colour was detected. Swallows decode errors and returns null — the
// caller treats the absence of a colour the same as a clean detection
// that didn't find one (no suggestion shown).
export async function extractDominantColorFromBlob(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      const { width, height } = scaleDownToFit(bitmap.width, bitmap.height, SAMPLE_MAX_DIMENSION);
      const buffer = renderBitmapToPixelBuffer(bitmap, width, height);
      return extractDominantColor(buffer);
    } finally {
      bitmap.close?.();
    }
  } catch (err) {
    // Decode failed (corrupted blob, no createImageBitmap support).
    // Phase 3's "extract on upload" path doesn't fail the upload —
    // it just leaves logo_dominant_color null. Surface the error
    // for triage but don't propagate.
    console.error('[extract-logo-color] decode failed', err);
    return null;
  }
}

// Preserves aspect ratio, fits within `max`. If the source already
// fits, returns the original dimensions unchanged.
function scaleDownToFit(
  srcWidth: number,
  srcHeight: number,
  max: number,
): { width: number; height: number } {
  if (srcWidth <= max && srcHeight <= max) {
    return { width: srcWidth, height: srcHeight };
  }
  const ratio = Math.min(max / srcWidth, max / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * ratio)),
    height: Math.max(1, Math.round(srcHeight * ratio)),
  };
}

// Mirrors the logo-transparency canvas pattern but produces a
// PixelBuffer the pure extractor can consume.
function renderBitmapToPixelBuffer(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): PixelBuffer {
  const canvas = createKeyingCanvas(width, height);
  const ctx = getReadContext(canvas);
  ctx.drawImage(bitmap, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data };
}

function getReadContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  // willReadFrequently=true keeps the canvas backed by software
  // bitmap rather than a GPU texture, which is what we want for a
  // one-shot getImageData call.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable');
  return ctx as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
}
