import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock browser-image-compression at the module level so the test runs in
// node without Canvas. The real compression is exercised in Playwright
// (11_persistence.spec.ts: photo persists after reload + size cap, and the
// stress test in TESTING.md §3.2).
vi.mock('browser-image-compression', () => ({
  default: vi.fn(),
}));

import imageCompression from 'browser-image-compression';
import { MAX_PHOTO_BYTES, MAX_PHOTO_DIMENSION, compressPhoto } from './compress-photo';

const mockedCompression = vi.mocked(imageCompression);

afterEach(() => {
  mockedCompression.mockReset();
  vi.unstubAllGlobals();
});

function fakeJpegBlob(bytes: number): Blob {
  const buffer = new Uint8Array(bytes);
  // Minimal JPEG SOI/APP0/EOI tail so MIME inference doesn't choke.
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[bytes - 2] = 0xff;
  buffer[bytes - 1] = 0xd9;
  return new Blob([buffer], { type: 'image/jpeg' });
}

describe('compressPhoto', () => {
  it('passes ADR-008 defaults to browser-image-compression', async () => {
    const compressed = fakeJpegBlob(180_000);
    mockedCompression.mockResolvedValue(compressed as unknown as File);
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 1280,
      height: 720,
      close: () => {},
    }));

    const input = fakeJpegBlob(3_500_000);
    const result = await compressPhoto(input);

    expect(mockedCompression).toHaveBeenCalledTimes(1);
    const opts = mockedCompression.mock.calls[0]?.[1];
    expect(opts).toMatchObject({
      maxSizeMB: MAX_PHOTO_BYTES / (1024 * 1024),
      maxWidthOrHeight: MAX_PHOTO_DIMENSION,
      fileType: 'image/jpeg',
      initialQuality: 0.8,
      useWebWorker: true,
    });
    expect(result.bytes).toBe(180_000);
    expect(result.bytes).toBeLessThanOrEqual(MAX_PHOTO_BYTES);
    expect(result.mime).toBe('image/jpeg');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.blob).toBeInstanceOf(Blob);
  });

  it('respects caller-overridden max bytes / dimension', async () => {
    mockedCompression.mockResolvedValue(fakeJpegBlob(50_000) as unknown as File);
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 800,
      height: 600,
      close: () => {},
    }));

    await compressPhoto(fakeJpegBlob(1_000_000), {
      maxBytes: 100 * 1024,
      maxDimension: 800,
    });

    const opts = mockedCompression.mock.calls[0]?.[1];
    expect(opts?.maxSizeMB).toBeCloseTo(100 / 1024, 5);
    expect(opts?.maxWidthOrHeight).toBe(800);
  });

  it('propagates the underlying library error', async () => {
    mockedCompression.mockRejectedValue(new Error('compress failed'));
    await expect(compressPhoto(fakeJpegBlob(100))).rejects.toThrow('compress failed');
  });

  it('falls back to image/jpeg when the blob has no MIME', async () => {
    const noMime = new Blob([new Uint8Array(50)]);
    mockedCompression.mockResolvedValue(noMime as unknown as File);
    vi.stubGlobal('createImageBitmap', async () => ({
      width: 200,
      height: 200,
      close: () => {},
    }));

    const result = await compressPhoto(fakeJpegBlob(1000));
    expect(result.mime).toBe('image/jpeg');
  });
});
