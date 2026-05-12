import { describe, expect, it } from 'vitest';
import {
  extractDominantColor,
  luminance,
  rgbToHex,
  saturation,
  shouldSkipPixel,
  type PixelBuffer,
} from './extract-logo-color';

// Builders that mint deterministic PixelBuffers without going through
// canvas. Tests stay in node (no jsdom) and the inputs are dense enough
// for the histogram pass to behave realistically.

function makeBuffer(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number, number],
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fill(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = a;
    }
  }
  return { width, height, data };
}

function solidColor(r: number, g: number, b: number, a = 255): PixelBuffer {
  return makeBuffer(16, 16, () => [r, g, b, a]);
}

// White outer ring + coloured inner square — the canonical "logo on
// light background" case the extractor was designed for.
function logoOnWhite(inner: [number, number, number], size = 32, innerSize = 16): PixelBuffer {
  const lo = (size - innerSize) / 2;
  const hi = lo + innerSize;
  return makeBuffer(size, size, (x, y) => {
    if (x >= lo && x < hi && y >= lo && y < hi) {
      return [inner[0], inner[1], inner[2], 255];
    }
    return [255, 255, 255, 255];
  });
}

describe('luminance', () => {
  it('black = 0, white = 1', () => {
    expect(luminance(0, 0, 0)).toBe(0);
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 5);
  });

  it('weights green most heavily (BT.601)', () => {
    // Pure green is much brighter than pure red or pure blue under
    // perceptual luma weights.
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0));
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(0, 0, 255));
  });
});

describe('saturation', () => {
  it('0 for pure greys (R = G = B)', () => {
    expect(saturation(0, 0, 0)).toBe(0);
    expect(saturation(128, 128, 128)).toBe(0);
    expect(saturation(255, 255, 255)).toBe(0);
  });

  it('1 for fully saturated primaries (one channel max, another zero)', () => {
    expect(saturation(255, 0, 0)).toBe(1);
    expect(saturation(0, 255, 0)).toBe(1);
    expect(saturation(0, 0, 255)).toBe(1);
  });

  it('intermediate for tints', () => {
    // (255, 200, 200) — soft pink. Max=255, min=200.
    expect(saturation(255, 200, 200)).toBeCloseTo((255 - 200) / 255, 5);
  });
});

describe('rgbToHex', () => {
  it('emits uppercase 6-digit hex prefixed with #', () => {
    expect(rgbToHex(255, 107, 53)).toBe('#FF6B35');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#FFFFFF');
    expect(rgbToHex(43, 76, 138)).toBe('#2B4C8A');
  });
});

describe('shouldSkipPixel', () => {
  it('skips alpha < 128 (transparent and edge)', () => {
    expect(shouldSkipPixel(255, 0, 0, 0)).toBe(true);
    expect(shouldSkipPixel(255, 0, 0, 127)).toBe(true);
    expect(shouldSkipPixel(255, 0, 0, 128)).toBe(false);
  });

  it('skips very light pixels (luminance > 0.9)', () => {
    // (255, 255, 255) luminance = 1.0
    expect(shouldSkipPixel(255, 255, 255, 255)).toBe(true);
    // (240, 240, 240) luminance ≈ 0.94
    expect(shouldSkipPixel(240, 240, 240, 255)).toBe(true);
  });

  it('skips near-black pixels (luminance < 0.1)', () => {
    expect(shouldSkipPixel(0, 0, 0, 255)).toBe(true);
    expect(shouldSkipPixel(20, 20, 20, 255)).toBe(true);
  });

  it('skips unsaturated mid-tones (greys at saturation < 0.1)', () => {
    expect(shouldSkipPixel(128, 128, 128, 255)).toBe(true);
    // 5% saturated grey: still skipped.
    expect(shouldSkipPixel(130, 125, 122, 255)).toBe(true);
  });

  it('keeps a typical brand-colour pixel (#FF6B35)', () => {
    expect(shouldSkipPixel(255, 107, 53, 255)).toBe(false);
  });

  it('keeps a brand blue (#2B4C8A)', () => {
    expect(shouldSkipPixel(43, 76, 138, 255)).toBe(false);
  });
});

describe('extractDominantColor — happy paths', () => {
  it('solid coloured square returns that colour', () => {
    expect(extractDominantColor(solidColor(255, 107, 53))).toBe('#FF6B35');
    expect(extractDominantColor(solidColor(43, 76, 138))).toBe('#2B4C8A');
  });

  it('coloured inner square on a white background returns the inner colour', () => {
    // The white outer ring is filtered out by the luminance > 0.9 gate.
    expect(extractDominantColor(logoOnWhite([255, 107, 53]))).toBe('#FF6B35');
    expect(extractDominantColor(logoOnWhite([43, 76, 138]))).toBe('#2B4C8A');
    expect(extractDominantColor(logoOnWhite([16, 145, 64]))).toBe('#109140');
  });

  it('multi-colour logo picks the largest cluster (tied count favours higher saturation)', () => {
    // 20x10 buffer: left half saturated red, right half saturated blue
    // — same pixel count. Saturation tie-break picks whichever
    // bucket the histogram visits last; either answer is acceptable
    // for the brief's "largest cluster" rule.
    const buf = makeBuffer(20, 10, (x) => {
      if (x < 10) return [220, 30, 30, 255]; // red
      return [30, 30, 220, 255]; // blue
    });
    const result = extractDominantColor(buf);
    expect(result === '#DC1E1E' || result === '#1E1EDC').toBe(true);
  });

  it('logo with a small bright accent plus a dominant secondary colour returns the secondary', () => {
    // 80% green, 20% red. The mode finder returns green even though
    // red is more saturated — count beats saturation outside of a tie.
    const buf = makeBuffer(20, 20, (x, y) => {
      const idx = y * 20 + x;
      if (idx < 80) return [220, 30, 30, 255];
      return [30, 200, 60, 255];
    });
    expect(extractDominantColor(buf)).toBe('#1EC83C');
  });
});

describe('extractDominantColor — null paths', () => {
  it('all-white image returns null (no qualifying pixels)', () => {
    expect(extractDominantColor(solidColor(255, 255, 255))).toBeNull();
  });

  it('all-black image returns null (caught by luminance < 0.1)', () => {
    expect(extractDominantColor(solidColor(0, 0, 0))).toBeNull();
  });

  it('all-grey image returns null (caught by saturation < 0.1)', () => {
    expect(extractDominantColor(solidColor(128, 128, 128))).toBeNull();
  });

  it('all-transparent image returns null', () => {
    // Every pixel has a brand-worthy RGB but alpha = 0.
    expect(extractDominantColor(solidColor(255, 107, 53, 0))).toBeNull();
  });

  it('logo dominated by a wash of pale pastel returns null (final saturation gate)', () => {
    // (255, 220, 215) — pale pastel. Saturation ≈ 0.157, above the
    // filter threshold (0.1) but below the final gate (0.3). The
    // wishy-washy centroid wouldn't be usable as an app accent, so
    // the extractor refuses.
    expect(extractDominantColor(solidColor(255, 220, 215))).toBeNull();
  });

  it('empty buffer returns null', () => {
    expect(
      extractDominantColor({
        width: 0,
        height: 0,
        data: new Uint8ClampedArray(0),
      }),
    ).toBeNull();
  });
});

describe('extractDominantColor — bucket precision', () => {
  it('a near-uniform colour with anti-alias noise centroids cleanly', () => {
    // 10x10 buffer: every pixel is brand orange ± 2 per channel.
    const buf = makeBuffer(10, 10, (x, y) => {
      const jitter = ((x + y) % 3) - 1; // -1, 0, or 1
      return [
        Math.max(0, Math.min(255, 255 + jitter)),
        Math.max(0, Math.min(255, 107 + jitter)),
        Math.max(0, Math.min(255, 53 + jitter)),
        255,
      ];
    });
    const result = extractDominantColor(buf);
    // All pixels fall in the same 5-bit bucket; centroid lands very
    // close to the average input value.
    expect(result).toMatch(/^#[A-F0-9]{6}$/);
    const r = parseInt(result!.slice(1, 3), 16);
    const g = parseInt(result!.slice(3, 5), 16);
    const b = parseInt(result!.slice(5, 7), 16);
    expect(Math.abs(r - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 107)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 53)).toBeLessThanOrEqual(2);
  });
});
