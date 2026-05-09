import { describe, expect, it } from 'vitest';
import { base64ToBlob, blobToBase64 } from './base64';

describe('blobToBase64 / base64ToBlob round-trip', () => {
  it('round-trips empty blobs', async () => {
    const blob = new Blob([], { type: 'image/jpeg' });
    const b64 = await blobToBase64(blob);
    expect(b64).toBe('');
    const back = base64ToBlob(b64, 'image/jpeg');
    expect(back.size).toBe(0);
    expect(back.type).toBe('image/jpeg');
  });

  it('round-trips small binary payloads', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xab, 0xcd]);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const b64 = await blobToBase64(blob);
    const back = base64ToBlob(b64, blob.type);
    const buf = new Uint8Array(await back.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(bytes));
  });

  it('handles buffers larger than the chunk size', async () => {
    const size = 9 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31) & 0xff;
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const b64 = await blobToBase64(blob);
    const back = base64ToBlob(b64, blob.type);
    const buf = new Uint8Array(await back.arrayBuffer());
    expect(buf.byteLength).toBe(size);
    expect(Array.from(buf.slice(0, 64))).toEqual(Array.from(bytes.slice(0, 64)));
    expect(Array.from(buf.slice(-64))).toEqual(Array.from(bytes.slice(-64)));
  });
});
