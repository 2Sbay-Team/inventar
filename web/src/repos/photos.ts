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
  const photo: Photo = {
    id: newUUID(),
    blob: input.blob,
    width: input.width,
    height: input.height,
    bytes: input.blob.size,
    mime: input.mime,
    created_at: nowISO(),
    deleted_at: null,
  };
  await db.photos.add(photo);
  return photo;
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
