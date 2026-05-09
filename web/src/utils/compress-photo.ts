import imageCompression from 'browser-image-compression';

// ADR-008: every photo is compressed to ≤ 200 KB before storage. Raw camera
// JPEGs are 3–5 MB; without this 500 articles would overflow IndexedDB on
// most Android devices and definitely on iOS Safari. We resize to max
// 1280 px wide and re-encode JPEG quality 80 (`browser-image-compression`
// defaults — kept explicit so tuning lives in one place).

export const MAX_PHOTO_BYTES = 200 * 1024;
export const MAX_PHOTO_DIMENSION = 1280;

export interface CompressedPhoto {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  mime: string;
}

interface CompressPhotoOptions {
  // Caller-overridable for tests / future tuning. Keep the defaults
  // load-bearing — they're the values ADR-008 commits to.
  maxBytes?: number;
  maxDimension?: number;
}

// Reads natural width/height from a Blob via createImageBitmap. We need this
// because browser-image-compression's compressed result doesn't expose the
// final dimensions, and the Photo row stores them so the UI can render
// without a layout flash.
async function readDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dims;
  }
  // Older Safari fallback — shouldn't trigger in our tested set, but keep
  // the path so an iPad iOS 14 install doesn't hard-fail.
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to read image dimensions'));
    };
    img.src = url;
  });
}

export async function compressPhoto(
  file: File | Blob,
  options: CompressPhotoOptions = {},
): Promise<CompressedPhoto> {
  const maxBytes = options.maxBytes ?? MAX_PHOTO_BYTES;
  const maxDimension = options.maxDimension ?? MAX_PHOTO_DIMENSION;

  // browser-image-compression takes maxSizeMB (decimal MB) and
  // maxWidthOrHeight (px). We always force JPEG output — IndexedDB stores
  // the Blob, and JPEG keeps photo size predictable.
  const compressed = await imageCompression(file as File, {
    maxSizeMB: maxBytes / (1024 * 1024),
    maxWidthOrHeight: maxDimension,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
    useWebWorker: true,
  });

  // The library returns a File (extends Blob). Normalise to Blob and capture
  // the actual final byte size.
  const blob: Blob =
    compressed instanceof Blob ? compressed : new Blob([compressed], { type: 'image/jpeg' });
  const { width, height } = await readDimensions(blob);

  return {
    blob,
    width,
    height,
    bytes: blob.size,
    mime: blob.type || 'image/jpeg',
  };
}
