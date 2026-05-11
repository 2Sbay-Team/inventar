import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { db } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';

// v0.6 ADR-030 — one-shot post-update toast. Mounted at the app root;
// on boot, reads meta.update_just_installed. If set, shows "Welcome to
// vX" for 4 seconds and clears the meta key so the toast doesn't
// re-surface on subsequent reloads.

const AUTO_DISMISS_MS = 4000;

export function AppUpdateToast(): JSX.Element | null {
  const { t } = useTranslation('updates');
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const v = await getMeta<string>(db, META_KEYS.update_just_installed);
      if (cancelled) return;
      if (v && v.trim() !== '') {
        setVersion(v);
        // Clear immediately so a fast-double-reload doesn't show it
        // twice; the local state already drives the visible toast.
        await setMeta(db, META_KEYS.update_just_installed, '');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!version) return;
    const id = window.setTimeout(() => setVersion(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [version]);

  if (!version) return null;

  return (
    <div
      data-testid="app-update-toast"
      role="status"
      aria-live="polite"
      className="bg-accent text-white fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg sm:left-1/2 sm:right-auto sm:w-[360px] sm:-translate-x-1/2"
    >
      {t('welcome', { version })}
    </div>
  );
}
