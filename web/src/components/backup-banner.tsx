import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { getMeta, setMeta, META_KEYS } from '../repos/meta';
import { nowISO } from '../utils/now';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function isOlderThan7Days(iso: string | null): boolean {
  if (iso === null) return true;
  return Date.now() - new Date(iso).getTime() > SEVEN_DAYS_MS;
}

export function BackupBanner(): JSX.Element | null {
  const { t } = useTranslation('backup');
  const profile = useProfile();
  const dismissedAt = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.backup_banner_dismissed_at)) ?? null,
    [],
    null,
  );

  if (!profile) return null;
  const needsBackup = isOlderThan7Days(profile.last_backup_at);
  const recentlyDismissed = !isOlderThan7Days(dismissedAt);
  if (!needsBackup || recentlyDismissed) return null;

  function dismiss(): void {
    void setMeta(db, META_KEYS.backup_banner_dismissed_at, nowISO());
  }

  return (
    <aside
      data-testid="backup-banner"
      className="bg-warn-soft border-warn/30 mx-4 mt-2 flex items-center gap-3 rounded-2xl border px-3 py-2.5"
    >
      <Download aria-hidden className="text-warn h-5 w-5 flex-shrink-0" strokeWidth={2} />
      <div className="flex-1">
        <p className="text-ink text-[13px] font-medium leading-tight">{t('banner_title')}</p>
        <Link
          to="/settings"
          data-testid="backup-banner-cta"
          className="text-warn mt-0.5 inline-block text-xs font-medium underline-offset-2 hover:underline"
        >
          {t('banner_cta')}
        </Link>
      </div>
      <button
        type="button"
        data-testid="backup-banner-dismiss"
        onClick={dismiss}
        className="text-ink-3 px-2 py-1 text-xs"
      >
        {t('banner_dismiss')}
      </button>
    </aside>
  );
}
