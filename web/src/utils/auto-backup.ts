import { type InventarDB } from '../db/db';
import { exportBackupBlob } from '../backup/export';
import { getMeta, setMeta, META_KEYS } from '../repos/meta';
import { nowISO } from './now';

// File System Access API helpers for the silent auto-backup feature.
//
// Supported in Chrome / Edge / Samsung Internet / Android Chrome (desktop
// AND mobile). NOT supported in Safari (any version) or Firefox. Callers
// should gate UI on isAutoBackupSupported() and fall back to manual export
// + smart reminder banners on unsupported browsers.
//
// FileSystemDirectoryHandle objects are structured-clonable, so IndexedDB
// can store them across page reloads. Permission, however, is granted
// per-session — we re-request via requestPermission() on every write,
// which the browser auto-grants silently if the user hasn't revoked it.

const BACKUP_FILENAME = 'inventar-auto-backup.json';

interface PickerWindow extends Window {
  showDirectoryPicker?: (opts?: {
    mode?: 'read' | 'readwrite';
    id?: string;
  }) => Promise<FileSystemDirectoryHandle>;
}

interface PermissionedHandle {
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
}

export function isAutoBackupSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

// Opens the OS folder picker. Returns null if the user cancelled, or if
// the API isn't supported. Caller is responsible for persisting the handle.
export async function pickAutoBackupFolder(): Promise<{
  handle: FileSystemDirectoryHandle;
  name: string;
} | null> {
  if (!isAutoBackupSupported()) return null;
  try {
    const win = window as PickerWindow;
    if (!win.showDirectoryPicker) return null;
    const handle = await win.showDirectoryPicker({
      mode: 'readwrite',
      id: 'inventar-auto-backup',
    });
    return { handle, name: handle.name };
  } catch {
    // AbortError = user cancelled; treat as null.
    return null;
  }
}

// Re-requests permission on the handle. The first request after a page
// load may show a one-tap permission prompt; subsequent ones in the same
// session are silent.
export async function ensureFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as PermissionedHandle;
  if (!h.queryPermission) return true;
  const status = await h.queryPermission({ mode: 'readwrite' });
  if (status === 'granted') return true;
  if (h.requestPermission) {
    const newStatus = await h.requestPermission({ mode: 'readwrite' });
    return newStatus === 'granted';
  }
  return false;
}

// Serialises the entire DB to JSON and writes it into the chosen folder.
// Stamps auto_backup_at on success.
export async function writeBackupToFolder(
  db: InventarDB,
  handle: FileSystemDirectoryHandle,
  appVersion: string,
): Promise<void> {
  const ok = await ensureFolderPermission(handle);
  if (!ok) throw new Error('Permission denied for auto-backup folder');
  const { blob } = await exportBackupBlob(db, { appVersion });
  const fileHandle = await handle.getFileHandle(BACKUP_FILENAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  await setMeta(db, META_KEYS.auto_backup_at, nowISO());
}

export async function setAutoBackupHandle(
  db: InventarDB,
  handle: FileSystemDirectoryHandle | null,
  folderName: string | null,
): Promise<void> {
  if (handle === null) {
    await db.meta.delete(META_KEYS.auto_backup_handle);
    await db.meta.delete(META_KEYS.auto_backup_folder_name);
    return;
  }
  await setMeta(db, META_KEYS.auto_backup_handle, handle);
  await setMeta(db, META_KEYS.auto_backup_folder_name, folderName);
}

export async function getAutoBackupHandle(
  db: InventarDB,
): Promise<FileSystemDirectoryHandle | null> {
  const v = await getMeta<FileSystemDirectoryHandle>(db, META_KEYS.auto_backup_handle);
  return v ?? null;
}
