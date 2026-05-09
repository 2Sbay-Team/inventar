import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Smartphone } from 'lucide-react';
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

  // Track whether the user explicitly arrived to install (via ?install=1
  // from the hoodhood.ai portfolio link). When set, we always show some
  // feedback — never silently render nothing — and we ignore the
  // dismissed-recently guard.
  const [arrivedToInstall, setArrivedToInstall] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('install') === '1') setArrivedToInstall(true);
  }, []);

  // Auto-trigger the install prompt when the user arrived with ?install=1
  // and the device supports programmatic install. Strip the query param so
  // a refresh doesn't re-fire. Other states get visible feedback below.
  const autoTriggered = useRef(false);
  useEffect(() => {
    if (autoTriggered.current) return;
    if (!arrivedToInstall) return;
    if (installState.kind !== 'installable') return;
    autoTriggered.current = true;
    void installState.install();
    const params = new URLSearchParams(window.location.search);
    params.delete('install');
    const next = window.location.pathname + (params.toString() ? `?${params.toString()}` : '');
    window.history.replaceState({}, '', next);
  }, [installState, arrivedToInstall]);

  // While the install API is still warming up (SW registering, browser
  // checking PWA criteria), show a soft "checking" pill if the user
  // arrived to install — keeps them from thinking the link is broken.
  if (installState.kind === 'checking') {
    if (!arrivedToInstall) return null;
    return (
      <aside
        data-testid="install-banner-checking"
        className="bg-paper-deep border-hair mx-4 mt-2 flex items-center gap-3 rounded-2xl border px-3 py-2.5"
      >
        <Download aria-hidden className="text-ink-3 h-5 w-5 flex-shrink-0" strokeWidth={2} />
        <p className="text-ink-2 flex-1 text-[13px] leading-tight">{t('install_checking')}</p>
      </aside>
    );
  }

  // Already-installed feedback: only shown if user explicitly came from the
  // install link. Otherwise no banner — installed users don't need a nag.
  if (installState.kind === 'installed') {
    if (!arrivedToInstall) return null;
    return (
      <aside
        data-testid="install-banner-installed"
        className="bg-ok-soft border-ok/30 mx-4 mt-2 flex items-center gap-3 rounded-2xl border px-3 py-2.5"
      >
        <Check aria-hidden className="text-ok h-5 w-5 flex-shrink-0" strokeWidth={2.5} />
        <p className="text-ink flex-1 text-[13px] font-medium leading-tight">
          {t('install_already')}
        </p>
        <button
          type="button"
          onClick={() => setArrivedToInstall(false)}
          className="text-ink-3 px-1 text-xs"
          aria-label="dismiss"
        >
          ×
        </button>
      </aside>
    );
  }

  // Unsupported browser feedback: same logic — only nag if user explicitly
  // tried to install. Now shows a real fallback (browser-menu instructions)
  // instead of the useless "use a recent browser" message.
  if (installState.kind === 'unsupported') {
    if (!arrivedToInstall) return null;
    return (
      <aside
        data-testid="install-banner-unsupported"
        className="bg-warn-soft border-warn/30 mx-4 mt-2 flex items-start gap-3 rounded-2xl border px-3 py-2.5"
      >
        <Smartphone
          aria-hidden
          className="text-warn mt-0.5 h-5 w-5 flex-shrink-0"
          strokeWidth={2}
        />
        <div className="flex-1">
          <p className="text-ink text-[13px] font-medium leading-tight">
            {t('install_manual_title')}
          </p>
          <p className="text-ink-2 mt-1 text-[12px] leading-relaxed">{t('install_manual_steps')}</p>
        </div>
        <button
          type="button"
          onClick={() => setArrivedToInstall(false)}
          className="text-ink-3 px-1 text-xs"
          aria-label="dismiss"
        >
          ×
        </button>
      </aside>
    );
  }

  // Installable / iOS path: respect the 30-day dismissal UNLESS the user
  // explicitly arrived to install — in that case always show.
  if (!arrivedToInstall && dismissedRecently(dismissedAt)) return null;

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
