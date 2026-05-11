// v0.5.4 ADR-027 — Logo background auto-removal via Canvas color-key.
//
// Merchants commonly upload logos with a uniform light background
// (white / off-white) sourced from Google search, screenshots, or
// basic graphics tools. Those render with a visible box against the
// app's cream theme. This utility key-fills the background to
// transparency using a 4-corner sampling + Euclidean RGB distance
// pass — no ML, no external dependencies, all in-browser.
//
// Cross-browser strategy: OffscreenCanvas where available (Chrome 69+,
// Edge 79+, Firefox 105+, Safari 16.4+, Samsung Internet 10+),
// HTMLCanvasElement fallback for iOS Safari 14-16.3. Both branches
// expose getContext('2d') / getImageData / putImageData / blob-export
// with the only difference being convertToBlob vs toBlob.
//
// Tolerance values (25 / 35) were chosen for typical JPEG-source
// white-background logos. If real-world fringing appears in the
// 25-35 anti-alias band, retune to 20-30 or 30-40 and document the
// reason in a comment next to the constants.

// ── Tunables ─────────────────────────────────────────────────────────
const KEY_TOLERANCE = 25; // pixels within this RGB distance → fully transparent
const ANTIALIAS_BAND = 35; // pixels 25-35 → alpha 128 (kills halos at the keyed edge)
const MAX_KEYING_DIMENSION = 800; // resize logos larger than this before keying

const LUMINANCE_THRESHOLD = 0.85; // BT.709 normalized, gate the auto-key
const SATURATION_THRESHOLD = 0.15; // HSL saturation normalized
const CORNER_STDDEV_THRESHOLD = 15; // sRGB scale 0-255, uniformity check
const ALL_TRANSPARENT_RATIO = 0.95; // if > 95% of pixels keyed → reject

const ALPHA_SAMPLE_COUNT = 16; // pixels checked when detecting prior transparency

// ── Public API ───────────────────────────────────────────────────────

export interface KeyingInput {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

export type KeyingOutcome =
  | { kind: 'skipped'; reason: 'already-transparent' | 'corners-not-light' }
  | { kind: 'keyed'; keyedBlob: Blob; keyedRatio: number }
  | { kind: 'rejected'; reason: 'all-transparent' | 'render-error' };

// Analyses a compressed logo and, if the background is detected as a
// uniform light colour, returns a PNG with that colour keyed to
// transparency. Otherwise returns 'skipped' (preserve original) or
// 'rejected' (image is mostly background — the caller should surface
// an error, not store the result).
export async function analyseLogoForKeying(input: KeyingInput): Promise<KeyingOutcome> {
  try {
    const bitmap = await loadBitmap(input.blob);
    try {
      // Skip when the source already has alpha — the merchant clearly
      // intended transparency. Cheap 16-pixel sample.
      if (bitmapHasTransparency(bitmap)) {
        return { kind: 'skipped', reason: 'already-transparent' };
      }

      const { width, height } = scaleDownToFit(bitmap.width, bitmap.height, MAX_KEYING_DIMENSION);
      const canvas = createKeyingCanvas(width, height);
      const ctx = getKeyingContext(canvas);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      const corners = sampleCorners(imageData);
      if (!cornersAreUniformLight(corners)) {
        return { kind: 'skipped', reason: 'corners-not-light' };
      }

      const meanRgb = meanCorner(corners);
      const keyedRatio = applyColorKey(imageData, meanRgb);
      if (keyedRatio >= ALL_TRANSPARENT_RATIO) {
        return { kind: 'rejected', reason: 'all-transparent' };
      }

      ctx.putImageData(imageData, 0, 0);
      const keyedBlob = await exportPng(canvas);
      return { kind: 'keyed', keyedBlob, keyedRatio };
    } finally {
      // ImageBitmap.close() is supported on every browser that has
      // ImageBitmap. Optional chain to be defensive on jsdom-style envs.
      bitmap.close?.();
    }
  } catch (err) {
    console.error('[logo-transparency] keying failed', err);
    return { kind: 'rejected', reason: 'render-error' };
  }
}

// ── Canvas factory ───────────────────────────────────────────────────

// Returns whichever canvas API is available. The OffscreenCanvas path
// runs off-main-thread-capable; the HTMLCanvasElement path covers
// older iOS Safari (14-16.3). Both expose the same 2D context surface.
export function createKeyingCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getKeyingContext(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  // willReadFrequently=true tells the browser to back the canvas with
  // a software bitmap rather than a GPU texture, which makes
  // getImageData / putImageData faster on Chromium.
  if (canvas instanceof OffscreenCanvas) {
    const ctx = canvas.getContext('2d', {
      willReadFrequently: true,
    }) as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');
    return ctx;
  }
  const ctx = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('HTMLCanvasElement 2D context unavailable');
  return ctx;
}

async function exportPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

// ── ImageBitmap helpers ──────────────────────────────────────────────

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  // createImageBitmap is universal across the app's target browsers.
  // imageOrientation: 'from-image' preserves EXIF rotation so logos
  // taken on a phone don't end up sideways.
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

// Cheap probabilistic check: sample 16 pixels spread across the image
// and return true if any has alpha < 255. This catches typical
// transparent-PNG logos (alpha-channel-aware) without an O(w*h) pass.
function bitmapHasTransparency(bitmap: ImageBitmap): boolean {
  const w = bitmap.width;
  const h = bitmap.height;
  const probe = createKeyingCanvas(w, h);
  const ctx = getKeyingContext(probe);
  ctx.drawImage(bitmap, 0, 0);
  // Spread samples across a 4x4 grid for deterministic coverage.
  const gridN = 4;
  for (let gy = 0; gy < gridN; gy += 1) {
    for (let gx = 0; gx < gridN; gx += 1) {
      const x = Math.min(w - 1, Math.floor((w * (gx + 0.5)) / gridN));
      const y = Math.min(h - 1, Math.floor((h * (gy + 0.5)) / gridN));
      const data = ctx.getImageData(x, y, 1, 1).data;
      if (data[3] !== undefined && data[3] < 255) return true;
    }
  }
  // Belt-and-braces: keep ALPHA_SAMPLE_COUNT as the documented count
  // (16 = 4x4) for the docstring and any future tweak; assert here.
  void ALPHA_SAMPLE_COUNT;
  return false;
}

function scaleDownToFit(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// ── Threshold gate (auto-detect "light uniform background") ──────────

interface RgbPixel {
  r: number;
  g: number;
  b: number;
}

// Structural type so the pure-math tests can pass a plain object;
// at runtime the production caller always hands in a real ImageData.
export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function sampleCorners(imageData: PixelBuffer): RgbPixel[] {
  const { width, height, data } = imageData;
  // 1px in from each corner so JPEG edge artifacts don't dominate the
  // sample. (Pure (0,0) on JPEG can carry compression block noise.)
  const points: Array<[number, number]> = [
    [1, 1],
    [width - 2, 1],
    [1, height - 2],
    [width - 2, height - 2],
  ];
  return points.map(([x, y]) => {
    const idx = (y * width + x) * 4;
    return {
      r: data[idx] ?? 0,
      g: data[idx + 1] ?? 0,
      b: data[idx + 2] ?? 0,
    };
  });
}

export function cornersAreUniformLight(corners: RgbPixel[]): boolean {
  if (corners.length === 0) return false;
  const mean = meanCorner(corners);
  // BT.709 luminance, normalised 0-1.
  const luminance = (0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b) / 255;
  if (luminance < LUMINANCE_THRESHOLD) return false;
  // HSL saturation of the mean corner colour.
  const saturation = hslSaturation(mean);
  if (saturation > SATURATION_THRESHOLD) return false;
  // Standard deviation across the 4 corners (sRGB scale 0-255) — high
  // stddev means the corners disagree, i.e. the background isn't
  // uniform (typical real-world photo).
  if (cornerStdDev(corners, mean) > CORNER_STDDEV_THRESHOLD) return false;
  return true;
}

export function meanCorner(corners: RgbPixel[]): RgbPixel {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of corners) {
    r += c.r;
    g += c.g;
    b += c.b;
  }
  const n = corners.length;
  return { r: r / n, g: g / n, b: b / n };
}

function cornerStdDev(corners: RgbPixel[], mean: RgbPixel): number {
  let sumSq = 0;
  for (const c of corners) {
    const dr = c.r - mean.r;
    const dg = c.g - mean.g;
    const db = c.b - mean.b;
    sumSq += dr * dr + dg * dg + db * db;
  }
  // Distance-based stddev: same scale as the keying tolerance.
  return Math.sqrt(sumSq / corners.length);
}

function hslSaturation(rgb: RgbPixel): number {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return 0;
  const delta = max - min;
  return lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
}

// ── The actual key-flood ─────────────────────────────────────────────

// Iterates every pixel; pixels within KEY_TOLERANCE of the mean corner
// colour are fully transparent, pixels in KEY_TOLERANCE..ANTIALIAS_BAND
// are alpha=128 (smooths the keyed edge so logos don't show a halo).
// Returns the fraction of pixels keyed — used by the caller to detect
// the all-transparent-result edge case.
export function applyColorKey(imageData: PixelBuffer, target: RgbPixel): number {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  let keyedCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const dr = (data[i] ?? 0) - target.r;
    const dg = (data[i + 1] ?? 0) - target.g;
    const db = (data[i + 2] ?? 0) - target.b;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    if (dist < KEY_TOLERANCE) {
      data[i + 3] = 0;
      keyedCount += 1;
    } else if (dist < ANTIALIAS_BAND) {
      data[i + 3] = 128;
    }
  }
  return keyedCount / pixelCount;
}

// Exported tunables so the test suite can assert them without
// duplicating the magic numbers.
export const LOGO_KEYING_CONSTANTS = {
  KEY_TOLERANCE,
  ANTIALIAS_BAND,
  MAX_KEYING_DIMENSION,
  LUMINANCE_THRESHOLD,
  SATURATION_THRESHOLD,
  CORNER_STDDEV_THRESHOLD,
  ALL_TRANSPARENT_RATIO,
} as const;
