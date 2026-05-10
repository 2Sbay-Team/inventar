import { type InventarDB } from '../db/db';
import { type Photo, type UUID } from '../types';
import { nowISO } from '../utils/now';
import { newUUID } from '../utils/uuid';

// ADR-008: Callers compress to ≤ 200 KB / max 1280 px wide BEFORE handing
// the Blob to this repo. The repo does not re-encode — it just persists
// what it is given and records the metadata.

export interface StorePhotoInput {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
}

export async function storePhoto(db: InventarDB, input: StorePhotoInput): Promise<Photo> {
  // v0.5.2.2 iOS Safari fix: store as Uint8Array (raw bytes) instead
  // of a Blob. Webkit's IDB implementation refuses to serialise
  // Blobs returned by canvas.toBlob() / browser-image-compression
  // with "Error preparing Blob/File data to be stored in object
  // store". Storing the bytes directly sidesteps the issue entirely;
  // readers reconstruct a Blob via photoToBlob(). Chromium / Firefox
  // are unaffected — both store Uint8Array fine, and the read-side
  // Blob construction is microsecond-cheap.
  const buf = await input.blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const photo: Photo = {
    id: newUUID(),
    blob: bytes,
    width: input.width,
    height: input.height,
    bytes: bytes.byteLength,
    mime: input.mime,
    created_at: nowISO(),
    deleted_at: null,
  };
  await db.photos.add(photo);
  return photo;
}

// v0.5.2.2: reconstructs a Blob from a Photo regardless of whether
// the storage shape is Uint8Array (post-fix) or Blob (legacy rows
// from before this commit). Callers that need a renderable Blob
// (createObjectURL, FileReader, fetch) MUST go through this helper.
export function photoToBlob(photo: Photo): Blob {
  if (photo.blob instanceof Blob) return photo.blob;
  return new Blob([photo.blob], { type: photo.mime });
}

// Returns undefined for missing OR tombstoned photos so the UI can fall
// back to a placeholder without learning about soft-delete state.
export async function getPhoto(db: InventarDB, id: UUID): Promise<Photo | undefined> {
  const p = await db.photos.get(id);
  if (!p || p.deleted_at !== null) return undefined;
  return p;
}

export async function softDeletePhoto(db: InventarDB, id: UUID): Promise<void> {
  const ts = nowISO();
  await db.photos.update(id, { deleted_at: ts });
}

// Hard delete — used by the Article cascade in articles.ts. We do not
// expose this to the UI directly: photo lifecycle is owned by Articles.
export async function hardDeletePhoto(db: InventarDB, id: UUID): Promise<void> {
  await db.photos.delete(id);
}
