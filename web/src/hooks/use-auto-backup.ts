import { useEffect, useRef, useState } from 'react';
import { db } from '../db/db';
import { useLive } from './use-live';
import {
  ensureFolderPermission,
  getAutoBackupHandle,
  writeBackupToFolder,
} from '../utils/auto-backup';
import { APP_VERSION } from '../config/app-version';

const DEBOUNCE_MS = 2000;

export type AutoBackupStatus = 'idle' | 'writing' | 'error';

// Reactively watches the database and re-writes the auto-backup file
// whenever any meaningful change settles for DEBOUNCE_MS. Mount once at
// the app root — the side effect runs as long as the component lives.
//
// Returns the current write status so the UI can show "Saving…" feedback.
// Returns 'idle' when no folder is configured.
export function useAutoBackup(): AutoBackupStatus {
  const [status, setStatus] = useState<AutoBackupStatus>('idle');
  const timer = useRef<number | null>(null);
  const initialPulse = useRef<string | null>(null);

  // Re-runs whenever counts or the latest updated_at across tables changes.
  // We don't care about the absolute number — the string just needs to
  // *change* to trigger the effect.
  const pulse = useLive<string>(
    async () => {
      const [a, v, m, e, p] = await Promise.all([
        db.articles.count(),
        db.variants.count(),
        db.movements.count(),
        db.expenses.count(),
        db.profile.count(),
      ]);
      const lastArticle = await db.articles.orderBy('updated_at').last();
      const lastExpense = await db.expenses.orderBy('at').last();
      const lastMovement = await db.movements.orderBy('created_at').last();
      const lastProfile = await db.profile.toCollection().first();
      return [
        a,
        v,
        m,
        e,
        p,
        lastArticle?.updated_at ?? '',
        lastExpense?.at ?? '',
        lastMovement?.created_at ?? '',
        lastProfile?.updated_at ?? '',
      ].join('|');
    },
    [],
    '',
  );

  useEffect(() => {
    if (!pulse) return;
    // Skip the very first pulse — that's just initial load, no real change.
    if (initialPulse.current === null) {
      initialPulse.current = pulse;
      return;
    }
    if (initialPulse.current === pulse) return;
    initialPulse.current = pulse;

    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void (async () => {
        const handle = await getAutoBackupHandle(db);
        if (!handle) return;
        const ok = await ensureFolderPermission(handle);
        if (!ok) {
          setStatus('error');
          return;
        }
        setStatus('writing');
        try {
          await writeBackupToFolder(db, handle, APP_VERSION);
          setStatus('idle');
        } catch (err) {
          // Folder may have been deleted, moved, or permission revoked.
          // Don't crash — log and surface as 'error' so UI can show.
          console.warn('Auto-backup failed:', err);
          setStatus('error');
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [pulse]);

  return status;
}
