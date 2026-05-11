import { describe, expect, it } from 'vitest';
import {
  applyColorKey,
  cornersAreUniformLight,
  LOGO_KEYING_CONSTANTS,
  meanCorner,
  sampleCorners,
  type PixelBuffer,
} from './logo-transparency';

// v0.5.4 ADR-026 — unit tests for the keying math + threshold gate.
// Integration coverage (the full analyseLogoForKeying call + blob
// round-trip + UI confirm flow) lives in the e2e specs 67-71. These
// tests stay in jsdom where ImageData is constructable and the
// threshold logic is deterministic.

function makeImageData(
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
  return { data, width, height };
}

describe('sampleCorners', () => {
  it('returns the 4 inset-by-1 corner pixels', () => {
    // Make a grid where pixel (x,y) = (x, y, 0, 255). Corners we sample
    // are 1px inset → (1,1), (w-2,1), (1,h-2), (w-2,h-2).
    const img = makeImageData(10, 10, (x, y) => [x, y, 0, 255]);
    const corners = sampleCorners(img);
    expect(corners).toHaveLength(4);
    expect(corners[0]).toEqual({ r: 1, g: 1, b: 0 });
    expect(corners[1]).toEqual({ r: 8, g: 1, b: 0 });
    expect(corners[2]).toEqual({ r: 1, g: 8, b: 0 });
    expect(corners[3]).toEqual({ r: 8, g: 8, b: 0 });
  });
});

describe('cornersAreUniformLight — threshold gate', () => {
  it('pure white corners pass all three checks', () => {
    const white = [
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 255, b: 255 },
    ];
    expect(cornersAreUniformLight(white)).toBe(true);
  });

  it('off-white #F5F5F5 corners pass (luminance ~0.96, saturation 0)', () => {
    const offWhite = [
      { r: 245, g: 245, b: 245 },
      { r: 245, g: 245, b: 245 },
      { r: 245, g: 245, b: 245 },
      { r: 245, g: 245, b: 245 },
    ];
    expect(cornersAreUniformLight(offWhite)).toBe(true);
  });

  it('medium grey fails luminance', () => {
    const grey = [
      { r: 128, g: 128, b: 128 },
      { r: 128, g: 128, b: 128 },
      { r: 128, g: 128, b: 128 },
      { r: 128, g: 128, b: 128 },
    ];
    expect(cornersAreUniformLight(grey)).toBe(false);
  });

  it('bright saturated colour fails saturation', () => {
    // Bright cyan: luminance ~0.78 → also fails luminance, but if we
    // had a colour that passes luminance with high saturation we'd
    // still want it rejected. Use very-light pink with high enough
    // saturation: #FFCFCF — luminance ~0.87, saturation ~0.19.
    const pink = [
      { r: 255, g: 207, b: 207 },
      { r: 255, g: 207, b: 207 },
      { r: 255, g: 207, b: 207 },
      { r: 255, g: 207, b: 207 },
    ];
    expect(cornersAreUniformLight(pink)).toBe(false);
  });

  it('non-uniform light corners fail stddev (photo with a bright sky in one corner)', () => {
    const photoCorners = [
      { r: 245, g: 245, b: 250 }, // bright sky
      { r: 50, g: 60, b: 40 }, // dark foliage
      { r: 240, g: 240, b: 240 },
      { r: 100, g: 100, b: 80 },
    ];
    expect(cornersAreUniformLight(photoCorners)).toBe(false);
  });

  it('empty corners array fails defensively', () => {
    expect(cornersAreUniformLight([])).toBe(false);
  });
});

describe('meanCorner', () => {
  it('returns the per-channel arithmetic mean', () => {
    const m = meanCorner([
      { r: 100, g: 100, b: 100 },
      { r: 200, g: 200, b: 200 },
    ]);
    expect(m).toEqual({ r: 150, g: 150, b: 150 });
  });
});

describe('applyColorKey', () => {
  it('zeroes alpha for pixels matching the target colour exactly', () => {
    const img = makeImageData(2, 2, () => [255, 255, 255, 255]);
    const ratio = applyColorKey(img, { r: 255, g: 255, b: 255 });
    expect(ratio).toBe(1); // every pixel keyed
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(0);
    }
  });

  it('leaves pixels outside the antialias band untouched', () => {
    const img = makeImageData(2, 2, () => [10, 10, 10, 255]); // dark
    const ratio = applyColorKey(img, { r: 255, g: 255, b: 255 }); // key white
    expect(ratio).toBe(0);
    for (let i = 3; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(255);
    }
  });

  it('drops pixels inside KEY_TOLERANCE to fully transparent', () => {
    // RGB distance from (255,255,255) → sqrt(14² × 3) ≈ 24.2, inside
    // the 25 tolerance.
    const img = makeImageData(1, 1, () => [241, 241, 241, 255]);
    applyColorKey(img, { r: 255, g: 255, b: 255 });
    expect(img.data[3]).toBe(0);
  });

  it('sets alpha=128 for pixels in the antialias band', () => {
    // Distance ~26: outside KEY_TOLERANCE (25), inside
    // ANTIALIAS_BAND (35). (255-240) × sqrt(3) ≈ 25.98.
    const img = makeImageData(1, 1, () => [240, 240, 240, 255]);
    applyColorKey(img, { r: 255, g: 255, b: 255 });
    expect(img.data[3]).toBe(128);
  });

  it('reports the keyed-pixel ratio for the all-transparent rejection check', () => {
    // 3 of 4 pixels white (keyed), 1 dark (kept).
    let count = 0;
    const img = makeImageData(2, 2, () => {
      count += 1;
      return count === 4 ? [10, 10, 10, 255] : [255, 255, 255, 255];
    });
    const ratio = applyColorKey(img, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(0.75, 5);
  });
});

describe('LOGO_KEYING_CONSTANTS — exposed tunables', () => {
  it('exposes the documented values', () => {
    expect(LOGO_KEYING_CONSTANTS.KEY_TOLERANCE).toBe(25);
    expect(LOGO_KEYING_CONSTANTS.ANTIALIAS_BAND).toBe(35);
    expect(LOGO_KEYING_CONSTANTS.MAX_KEYING_DIMENSION).toBe(800);
    expect(LOGO_KEYING_CONSTANTS.LUMINANCE_THRESHOLD).toBe(0.85);
    expect(LOGO_KEYING_CONSTANTS.SATURATION_THRESHOLD).toBe(0.15);
    expect(LOGO_KEYING_CONSTANTS.CORNER_STDDEV_THRESHOLD).toBe(15);
    expect(LOGO_KEYING_CONSTANTS.ALL_TRANSPARENT_RATIO).toBe(0.95);
  });
});

// createKeyingCanvas + the full analyseLogoForKeying integration are
// covered by the E2E specs (67-71) where a real DOM + ImageBitmap +
// canvas blob-export are available. The pure-math helpers above are
// what's important to assert deterministically.
