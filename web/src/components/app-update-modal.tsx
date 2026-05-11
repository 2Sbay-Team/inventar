import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Sparkles } from 'lucide-react';
import { useAppUpdate } from '../hooks/use-app-update';
import { useLocale } from '../hooks/use-locale';

// v0.6 ADR-031 — full-attention update consent modal. Renders when
// useAppUpdate.status === 'prompting'. The Radix Dialog is blocking
// (no outside-click dismiss, no Esc dismiss) per the brief — the
// merchant must pick one of the three options.

export function AppUpdateModal(): JSX.Element | null {
  const { t } = useTranslation('updates');
  const { locale } = useLocale();
  const update = useAppUpdate();

  if (update.status === 'idle' || update.status === 'loading') return null;

  const highlights = update.whatsNew?.highlights[locale] ?? null;
  const hasWhatsNew = highlights !== null && highlights.length > 0;
  const installing = update.status === 'installing';

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="app-update-overlay"
          className="fixed inset-0 z-40 bg-black/40"
        />
        <Dialog.Content
          data-testid="app-update-modal"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="bg-paper fixed inset-x-3 top-1/2 z-50 max-w-md -translate-y-1/2 rounded-2xl p-5 shadow-xl sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
        >
          <div className="flex items-start gap-3">
            <span className="bg-accent text-white flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full">
              <Sparkles aria-hidden className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="flex flex-1 flex-col">
              <Dialog.Title
                data-testid="app-update-title"
                className="font-display text-ink text-lg font-semibold leading-tight"
              >
                {update.promptVersion
                  ? t('title_with_version', { version: update.promptVersion })
                  : t('title_generic')}
              </Dialog.Title>
              <Dialog.Description className="text-ink-3 mt-1 text-xs">
                {t('subtitle')}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4">
            <h4 className="text-ink-2 text-xs font-semibold uppercase tracking-wide">
              {t('whats_new_heading')}
            </h4>
            {hasWhatsNew ? (
              <ul
                data-testid="app-update-highlights"
                className="text-ink mt-2 list-disc space-y-1.5 ps-5 text-sm leading-snug"
              >
                {highlights!.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            ) : (
              <p data-testid="app-update-fallback" className="text-ink mt-2 text-sm leading-snug">
                {t('whats_new_fallback')}
              </p>
            )}
          </div>

          <p className="text-ink-3 mt-4 text-xs">{t('data_safe')}</p>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              data-testid="app-update-install"
              autoFocus
              disabled={installing}
              onClick={() => void update.installNow()}
              className="bg-accent w-full rounded-xl py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {installing ? t('installing') : t('install_now')}
            </button>
            <button
              type="button"
              data-testid="app-update-snooze"
              disabled={installing}
              onClick={() => void update.snooze()}
              className="border-hair w-full rounded-xl border bg-white py-2.5 text-sm font-medium text-ink disabled:opacity-60"
            >
              {t('snooze')}
            </button>
            <button
              type="button"
              data-testid="app-update-skip"
              disabled={installing}
              onClick={() => void update.skip()}
              className="text-ink-3 w-full rounded-xl bg-transparent py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {t('skip')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
