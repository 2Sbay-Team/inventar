// v0.9 ADR-042 — Dominant-colour extraction for merchant logos.
//
// Phase 3 reads pixels off a decoded logo bitmap and returns a single
// representative hex colour the brand-color suggestion can offer back
// to the merchant. The extractor is intentionally simple: filter out
// obvious "not a brand colour" pixels (transparent / background /
// shadow / unsaturated greys), bucket what's left into a 5-bit-per-
// channel histogram, pick the largest bucket, and use its centroid as
// the answer. Pure — takes a PixelBuffer in, returns hex or null.
//
// Why not k-means / median-cut / node-vibrant. The Brand Studio brief
// chose "write from scratch" to avoid the dependency. For logos —
// which are overwhelmingly flat-color graphics, not photos — a single-
// pass mode finder gives results indistinguishable from k-means at a
// fraction of the code. Tweaking constants below is the lever for
// adjusting accuracy if real-world logos surface edge cases later.
//
// What we filter out, with thresholds set so a "typical" merchant logo
// (one or two saturated brand colors on a light background, maybe a
// dark text outline) gives back exactly the brand colour:
//
//   * alpha < 128       — transparent / nearly-transparent pixels.
//                         The transparency-removal pass (ADR-028)
//                         keys the background; we ignore anything
//                         it dropped.
//   * luminance > 0.9   — very light pixels. Catches off-white
//                         backgrounds that survived keying.
//   * luminance < 0.1   — near-black pixels. Catches shadow text
//                         and dark outlines that aren't the brand
//                         identity.
//   * saturation < 0.1  — greys. A neutral logo (charcoal text on
//                         white) has no brand colour to extract;
//                         we want to return null in that case.
//
// And the final gate: even after picking the largest cluster, if the
// centroid's saturation is below 0.3 we reject it. A logo dominated
// by faint pastel pinks would have plenty of pixels above 0.1
// saturation but produce a wishy-washy centroid; 0.3 is the floor
// below which the suggested colour wouldn't be usable as an app
// accent.

export interface PixelBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

// ── Tunables (see file header for rationale). ────────────────────────
const ALPHA_MIN = 128;
const LUMINANCE_MAX = 0.9;
const LUMINANCE_MIN = 0.1;
const SATURATION_MIN_FILTER = 0.1;
const SATURATION_MIN_FINAL = 0.3;
// 5-bit-per-channel bucketing. 2^15 = 32 768 buckets max. For an
// 800x800 logo (640k pixels), the histogram is dense enough that
// the largest bucket has hundreds of votes — way past statistical
// noise — without the bucket count exploding into the heap.
const BUCKET_SHIFT = 3; // 8 - BUCKET_SHIFT = 5 bits per channel

// BT.709-style luma approximation. Same coefficients as the keying
// utility uses for its "corners are light" check (logo-transparency.ts),
// so a logo flagged as "corners light" by that pass and "background
// filtered out" by this one share the same thresholding heuristic.
export function luminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Standard HSV-style saturation. Returns 0 for pure greys / black,
// 1 for a fully saturated primary. `max === 0` is the all-black
// case — return 0 to keep the divisor safe.
export function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

// Encode an (r, g, b) triple as a 6-digit `#RRGGBB` string in upper case.
// Matches the format the rest of the app stores in DB columns
// (ShopProfile.brand_primary_color and friends are upper-case hex).
export function rgbToHex(r: number, g: number, b: number): string {
  const hex = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Visible for tests — predicate the extractor uses to skip a pixel.
export function shouldSkipPixel(r: number, g: number, b: number, a: number): boolean {
  if (a < ALPHA_MIN) return true;
  const lum = luminance(r, g, b);
  if (lum > LUMINANCE_MAX) return true;
  if (lum < LUMINANCE_MIN) return true;
  if (saturation(r, g, b) < SATURATION_MIN_FILTER) return true;
  return false;
}

interface Bucket {
  r: number;
  g: number;
  b: number;
  count: number;
}

// Single-pass histogram + mode finder. Returns hex or null.
//
// Returns null when:
//   * The buffer has no pixels (degenerate input)
//   * Every pixel was filtered out (e.g. a pure-white image, or an
//     all-grey logo with no saturated regions)
//   * The largest cluster's centroid fails the final saturation gate
export function extractDominantColor(buffer: PixelBuffer): string | null {
  const { data } = buffer;
  if (data.length < 4) return null;

  // Histogram keyed by 15-bit bucket id ((rq<<10)|(gq<<5)|bq). Values
  // accumulate the raw r/g/b sums so the centroid is precise — we
  // average inside the bucket back at full 8-bit resolution.
  const buckets = new Map<number, Bucket>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (shouldSkipPixel(r, g, b, a)) continue;

    const key = ((r >> BUCKET_SHIFT) << 10) | ((g >> BUCKET_SHIFT) << 5) | (b >> BUCKET_SHIFT);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { r, g, b, count: 1 });
    } else {
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      bucket.count += 1;
    }
  }

  if (buckets.size === 0) return null;

  // Walk buckets, track the largest. Tie-break by higher saturation
  // — when two buckets tie on count, prefer the more vivid colour
  // as the brand identity. Logos commonly have a single saturated
  // logo mark plus equal-area dark text; this tilt picks the mark.
  let bestCount = -1;
  let bestSat = -1;
  let bestR = 0;
  let bestG = 0;
  let bestB = 0;
  for (const bucket of buckets.values()) {
    const cr = Math.round(bucket.r / bucket.count);
    const cg = Math.round(bucket.g / bucket.count);
    const cb = Math.round(bucket.b / bucket.count);
    const sat = saturation(cr, cg, cb);
    if (bucket.count > bestCount || (bucket.count === bestCount && sat > bestSat)) {
      bestCount = bucket.count;
      bestSat = sat;
      bestR = cr;
      bestG = cg;
      bestB = cb;
    }
  }

  if (bestSat < SATURATION_MIN_FINAL) return null;
  return rgbToHex(bestR, bestG, bestB);
}
