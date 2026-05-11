import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';

// v0.5.4 ADR-026 — minimal PNG encoder for the logo-keying E2E specs.
// Truecolor-with-alpha (color type 6) so we can fabricate exact pixel
// layouts that exercise the keying threshold gate, the anti-alias band,
// and the all-transparent rejection path deterministically — without
// committing binary fixtures or pulling in `sharp` / `pngjs`.
//
// The encoder is intentionally tiny: PNG signature + IHDR + a single
// IDAT (deflated raw scanlines, filter=None) + IEND. Good enough for
// 100×100 test images.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

type RGBA = readonly [number, number, number, number];
type RGB = readonly [number, number, number];

export function encodeRGBA(pixels: RGBA[][]): Buffer {
  const height = pixels.length;
  const width = pixels[0]?.length ?? 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor + alpha
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // filter method 0
  ihdr.writeUInt8(0, 12); // no interlace
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowOff = y * (1 + width * 4);
    raw[rowOff] = 0; // filter byte: None
    for (let x = 0; x < width; x += 1) {
      const px = pixels[y]![x]!;
      const off = rowOff + 1 + x * 4;
      raw[off] = px[0];
      raw[off + 1] = px[1];
      raw[off + 2] = px[2];
      raw[off + 3] = px[3];
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fill(width: number, height: number, fn: (x: number, y: number) => RGBA): RGBA[][] {
  const rows: RGBA[][] = [];
  for (let y = 0; y < height; y += 1) {
    const row: RGBA[] = [];
    for (let x = 0; x < width; x += 1) row.push(fn(x, y));
    rows.push(row);
  }
  return rows;
}

// Pure-white bg with a centred opaque colored square. The keyer should
// detect uniform light corners (luminance≈1, saturation=0, stddev=0)
// and key the white to transparency.
export function synthWhiteBgWithSquare({
  size = 100,
  square = 40,
  squareColor = [200, 0, 0] as RGB,
}: { size?: number; square?: number; squareColor?: RGB } = {}): Buffer {
  const lo = Math.floor((size - square) / 2);
  const hi = lo + square;
  return encodeRGBA(
    fill(size, size, (x, y) =>
      x >= lo && x < hi && y >= lo && y < hi
        ? [squareColor[0], squareColor[1], squareColor[2], 255]
        : [255, 255, 255, 255],
    ),
  );
}

// Off-white #F5F5F5 bg + centred colored square. Hard pixel edges; the
// JPEG round-trip applied by compress-photo (quality 0.8) naturally
// smears the square's boundary into intermediate gray values, some of
// which land in the keyer's [25, 35) anti-alias distance band and end
// up with alpha=128 in the keyed PNG.
export function synthOffWhiteBgWithSquare({
  size = 100,
  square = 40,
}: { size?: number; square?: number } = {}): Buffer {
  const lo = Math.floor((size - square) / 2);
  const hi = lo + square;
  return encodeRGBA(
    fill(size, size, (x, y) =>
      x >= lo && x < hi && y >= lo && y < hi ? [200, 0, 0, 255] : [245, 245, 245, 255],
    ),
  );
}

// Photo-like image with four very different corner colours (foliage,
// warm light, brown, pale yellow). The keyer's threshold gate fails on
// luminance and cross-corner stddev, so it returns 'skipped' and the
// caller stores the original (un-keyed) compressed JPEG.
export function synthHighVariancePhoto({ size = 100 }: { size?: number } = {}): Buffer {
  return encodeRGBA(
    fill(size, size, (x, y) => {
      const left = x < size / 2;
      const top = y < size / 2;
      if (top && left) return [40, 80, 30, 255];
      if (top && !left) return [220, 130, 60, 255];
      if (!top && left) return [120, 110, 90, 255];
      return [240, 220, 130, 255];
    }),
  );
}
