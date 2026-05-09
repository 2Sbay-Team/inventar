import { useTranslation } from 'react-i18next';
import { Download, Smartphone } from 'lucide-react';
import { db } from '../db/db';
import { useInstallPrompt } from '../hooks/use-install-prompt';
import { useLive } from '../hooks/use-live';
import { getMeta, setMeta, META_KEYS } from '../repos/meta';
import { nowISO } from '../utils/now';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function dismissedRecently(iso: string | null): boolean {
  if (iso === null) return false;
  return Date.now() - new Date(iso).getTime() < THIRTY_DAYS_MS;
}

// Above-the-fold prompt to install the PWA on the user's device. Renders
// only when (a) the device can install, (b) it isn't already installed,
// and (c) the user hasn't dismissed in the last 30 days.
export function InstallBanner(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const installState = useInstallPrompt();
  const dismissedAt = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.install_banner_dismissed_at)) ?? null,
    [],
    null,
  );

  if (installState.kind === 'installed' || installState.kind === 'unsupported') return null;
  if (dismissedRecently(dismissedAt)) return null;

  function dismiss(): void {
    void setMeta(db, META_KEYS.install_banner_dismissed_at, nowISO());
  }

  return (
    <aside
      data-testid="install-banner"
      className="bg-accent-soft border-accent/30 mx-4 mt-2 flex items-center gap-3 rounded-2xl border px-3 py-2.5"
    >
      {installState.kind === 'installable' ? (
        <>
          <Download aria-hidden className="text-accent h-5 w-5 flex-shrink-0" strokeWidth={2} />
          <div className="flex-1">
            <p className="text-ink text-[13px] font-medium leading-tight">{t('install_button')}</p>
            <p className="text-ink-2 mt-0.5 text-[11px] leading-tight">{t('install_hint')}</p>
          </div>
          <button
            type="button"
            data-testid="install-banner-cta"
            onClick={() => void installState.install()}
            className="bg-accent flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
          >
            {t('install_button')}
          </button>
          <button
            type="button"
            data-testid="install-banner-dismiss"
            onClick={dismiss}
            className="text-ink-3 px-1 text-xs"
            aria-label="dismiss"
          >
            ×
          </button>
        </>
      ) : (
        // ios-instructions
        <>
          <Smartphone aria-hidden className="text-accent h-5 w-5 flex-shrink-0" strokeWidth={2} />
          <div className="flex-1">
            <p className="text-ink text-[13px] font-medium leading-tight">
              {t('install_ios_title')}
            </p>
            <p className="text-ink-2 mt-0.5 text-[11px] leading-tight">{t('install_ios_steps')}</p>
          </div>
          <button
            type="button"
            data-testid="install-banner-dismiss"
            onClick={dismiss}
            className="text-ink-3 px-1 text-xs"
            aria-label="dismiss"
          >
            ×
          </button>
        </>
      )}
    </aside>
  );
}
