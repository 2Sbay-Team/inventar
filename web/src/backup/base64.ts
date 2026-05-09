// Blob ⇄ base64 helpers. Used only by the backup/export-import flow to embed
// photos into the JSON file. Avoids FileReader (works in Node tests too).

export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  // btoa accepts a binary string; build it in 8KB chunks to avoid a giant
  // String.fromCharCode call that would blow the stack on large photos.
  const CHUNK = 8 * 1024;
  let binary = '';
  for (let i = 0; i < buffer.length; i += CHUNK) {
    const slice = buffer.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(buffer).toString('base64');
}

export function base64ToBlob(b64: string, mime: string): Blob {
  const binary =
    typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
