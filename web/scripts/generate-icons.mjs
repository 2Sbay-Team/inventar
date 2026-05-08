// Generates PWA icons + favicons from /opt/inventar/final-logo.png.
// Pure Node stdlib (zlib, Buffer) — no third-party deps.
// Run with: node scripts/generate-icons.mjs
//
// Output:
//   public/icons/icon-{192,512}.png            (transparent bleed, real logo)
//   public/icons/icon-maskable-{192,512}.png   (paper-filled safe zone)
//   public/icons/favicon-{16,32}.png           (transparent bleed)
//   public/icons/apple-touch-icon.png          (180x180, paper background)
//   public/favicon.ico                         (32x32 PNG-embedded ICO)
//
// Source: ../final-logo.png (1187x1187 RGBA hoopoe-head logo).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '..');
const ICONS_OUT = resolve(ROOT, 'public', 'icons');
const PUBLIC_OUT = resolve(ROOT, 'public');
const SOURCE = resolve(ROOT, '..', 'final-logo.png');
mkdirSync(ICONS_OUT, { recursive: true });

// Brand: paper background for opaque icons (Android maskable, apple-touch, favicon).
const PAPER = [0xf4, 0xf1, 0xea, 0xff];

// ── CRC + PNG chunk helpers ───────────────────────────────────────
function crc32(buf) {
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function ihdr(width, height) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b.writeUInt8(8, 8); // bit depth
  b.writeUInt8(6, 9); // colour type RGBA
  b.writeUInt8(0, 10); // compression
  b.writeUInt8(0, 11); // filter
  b.writeUInt8(0, 12); // interlace
  return b;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ── PNG decode (RGBA 8-bit, non-interlaced only) ──────────────────
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let interlace = 0;
  const idatParts = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    off += 4;
    const type = buf.subarray(off, off + 4).toString('ascii');
    off += 4;
    const data = buf.subarray(off, off + len);
    off += len;
    off += 4; // skip CRC
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colourType = data.readUInt8(9);
      interlace = data.readUInt8(12);
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || colourType !== 6) {
    throw new Error(
      `unsupported PNG: depth=${bitDepth} colourType=${colourType} (need 8-bit RGBA)`,
    );
  }
  if (interlace !== 0) throw new Error('interlaced PNGs not supported');

  const inflated = inflateSync(Buffer.concat(idatParts));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let prev = Buffer.alloc(stride);
  let inOff = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[inOff++];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inOff++];
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let val;
      switch (filter) {
        case 0:
          val = raw;
          break;
        case 1:
          val = (raw + left) & 0xff;
          break;
        case 2:
          val = (raw + up) & 0xff;
          break;
        case 3:
          val = (raw + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          val = (raw + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`bad filter byte ${filter}`);
      }
      row[x] = val;
    }
    row.copy(out, y * stride);
    prev = row;
  }
  return { width, height, pixels: out };
}

// ── Box-filter resample, premultiplied-alpha-correct ──────────────
function resample(src, dstW, dstH) {
  const { width: srcW, height: srcH, pixels: srcP } = src;
  const dst = Buffer.alloc(dstW * dstH * 4);
  const sx = srcW / dstW;
  const sy = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const y0 = y * sy;
    const y1 = (y + 1) * sy;
    const yi0 = Math.floor(y0);
    const yi1 = Math.min(srcH, Math.ceil(y1));
    for (let x = 0; x < dstW; x++) {
      const x0 = x * sx;
      const x1 = (x + 1) * sx;
      const xi0 = Math.floor(x0);
      const xi1 = Math.min(srcW, Math.ceil(x1));
      let rR = 0;
      let rG = 0;
      let rB = 0;
      let rA = 0;
      let weight = 0;
      for (let yy = yi0; yy < yi1; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = xi0; xx < xi1; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const off = (yy * srcW + xx) * 4;
          const a = srcP[off + 3];
          rR += srcP[off] * a * w;
          rG += srcP[off + 1] * a * w;
          rB += srcP[off + 2] * a * w;
          rA += a * w;
          weight += w;
        }
      }
      const off = (y * dstW + x) * 4;
      if (rA > 0) {
        dst[off] = Math.round(rR / rA);
        dst[off + 1] = Math.round(rG / rA);
        dst[off + 2] = Math.round(rB / rA);
        dst[off + 3] = Math.round(rA / weight);
      } else {
        dst[off] = 0;
        dst[off + 1] = 0;
        dst[off + 2] = 0;
        dst[off + 3] = 0;
      }
    }
  }
  return { width: dstW, height: dstH, pixels: dst };
}

// ── Composite over solid background (opaque output) ───────────────
function compositeOnto(img, bg) {
  const { width, height, pixels } = img;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const a = pixels[off + 3] / 255;
    out[off] = Math.round(pixels[off] * a + bg[0] * (1 - a));
    out[off + 1] = Math.round(pixels[off + 1] * a + bg[1] * (1 - a));
    out[off + 2] = Math.round(pixels[off + 2] * a + bg[2] * (1 - a));
    out[off + 3] = 0xff;
  }
  return { width, height, pixels: out };
}

// ── Centred composite with paper fill (for maskable) ──────────────
function maskableImage(srcResampled, size) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const off = i * 4;
    canvas[off] = PAPER[0];
    canvas[off + 1] = PAPER[1];
    canvas[off + 2] = PAPER[2];
    canvas[off + 3] = PAPER[3];
  }
  const { width: w, height: h, pixels: p } = srcResampled;
  const dx = (size - w) >> 1;
  const dy = (size - h) >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sOff = (y * w + x) * 4;
      const dOff = ((y + dy) * size + (x + dx)) * 4;
      const a = p[sOff + 3] / 255;
      canvas[dOff] = Math.round(p[sOff] * a + canvas[dOff] * (1 - a));
      canvas[dOff + 1] = Math.round(p[sOff + 1] * a + canvas[dOff + 1] * (1 - a));
      canvas[dOff + 2] = Math.round(p[sOff + 2] * a + canvas[dOff + 2] * (1 - a));
      canvas[dOff + 3] = 0xff;
    }
  }
  return { width: size, height: size, pixels: canvas };
}

// ── PNG encode (filter None, deflate) ─────────────────────────────
function encodePNG({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0; // filter byte: None
    pixels.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr(width, height)),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO writer (single PNG-embedded entry) ────────────────────────
function buildICO(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

// ── Main ──────────────────────────────────────────────────────────
const sourceBuf = readFileSync(SOURCE);
const master = decodePNG(sourceBuf);
console.log(`source: ${master.width}x${master.height} RGBA`);

const TARGETS = [
  { name: 'icon-192.png', size: 192, kind: 'transparent' },
  { name: 'icon-512.png', size: 512, kind: 'transparent' },
  { name: 'favicon-16.png', size: 16, kind: 'transparent' },
  { name: 'favicon-32.png', size: 32, kind: 'transparent' },
  { name: 'apple-touch-icon.png', size: 180, kind: 'opaque-paper' },
];

for (const t of TARGETS) {
  const resampled = resample(master, t.size, t.size);
  const final = t.kind === 'opaque-paper' ? compositeOnto(resampled, PAPER) : resampled;
  writeFileSync(resolve(ICONS_OUT, t.name), encodePNG(final));
  console.log(`wrote icons/${t.name} (${t.size}px)`);
}

for (const size of [192, 512]) {
  const inner = Math.round(size * 0.64);
  const resampled = resample(master, inner, inner);
  const masked = maskableImage(resampled, size);
  writeFileSync(resolve(ICONS_OUT, `icon-maskable-${size}.png`), encodePNG(masked));
  console.log(`wrote icons/icon-maskable-${size}.png (${size}px)`);
}

{
  const resampled = resample(master, 32, 32);
  const composited = compositeOnto(resampled, PAPER);
  const png = encodePNG(composited);
  const ico = buildICO(png, 32);
  writeFileSync(resolve(PUBLIC_OUT, 'favicon.ico'), ico);
  console.log('wrote favicon.ico (32px PNG-embedded)');
}
