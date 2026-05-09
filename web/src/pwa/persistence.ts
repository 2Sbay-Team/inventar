import { db as appDB, type InventarDB } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';

// ADR-008: on first launch we ask the browser to mark our IndexedDB as
// persistent so it isn't evicted under storage pressure. Asking is idempotent
// in the browser, but we record success in `meta` so the UI can tell the
// user (Settings → Storage → Refresh persistence) whether it stuck.

export interface PersistenceResult {
  // The browser's verdict — true means our data is now persistent.
  granted: boolean;
  // Whether the API was even available in this environment.
  supported: boolean;
}

export async function ensurePersistence(db: InventarDB = appDB): Promise<PersistenceResult> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { granted: false, supported: false };
  }

  const already = await navigator.storage.persisted?.().catch(() => false);
  if (already) {
    await setMeta(db, META_KEYS.persistence_requested, true);
    return { granted: true, supported: true };
  }

  const granted = await navigator.storage.persist().catch(() => false);
  await setMeta(db, META_KEYS.persistence_requested, true);
  return { granted: Boolean(granted), supported: true };
}

export async function persistenceRequested(db: InventarDB = appDB): Promise<boolean> {
  return Boolean(await getMeta<boolean>(db, META_KEYS.persistence_requested));
}
