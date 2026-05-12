import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Check, Package, Sparkles } from 'lucide-react';
import { useAppUpdate } from '../hooks/use-app-update';
import { useLocale } from '../hooks/use-locale';
import { downloadBackupFile } from '../backup/download';
import type { BackupFormatChange, MigrationInfo } from '../pwa/fetch-whats-new';

// v0.6 ADR-031 / v0.6.2 ADR-032 — full-attention update-consent
// modal. Renders three layouts keyed off riskLevel:
//
//   safe       — reassurance copy + 3-button stack (Install / Snooze / Skip)
//   migration  — warning block + export-backup hint + 3-button stack
//   breaking   — strong warning + REQUIRED export gate + 2-button stack
//                (Cancel primary; Install disabled until export tapped;
//                no Snooze/Skip — "force consideration")
//
// The hook (useAppUpdate) drives the consent gate. The modal's only
// local state is `backupExported` — whether the merchant has tapped
// [Export backup now] in this modal session. Per ADR-032 Q3 the state
// resets every time the modal re-opens (no IDB persistence).

// Kept in lock-step with src/hooks/use-auto-backup.ts and
// src/screens/settings.tsx — see SPEC §10 for the version-pinning
// rule. The build will eventually inject this; for now the duplicate
// is acceptable.
const APP_VERSION = '1.0.0';

export function AppUpdateModal(): JSX.Element | null {
  const { t } = useTranslation('updates');
  const { locale } = useLocale();
  const update = useAppUpdate();
  const [backupExported, setBackupExported] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (update.status === 'idle' || update.status === 'loading') return null;

  const installing = update.status === 'installing';
  const risk = update.riskLevel;
  const isBreaking = risk === 'breaking';
  const isMigration = risk === 'migration';

  const highlights = update.whatsNew?.highlights[locale] ?? null;
  const hasWhatsNew = highlights !== null && highlights.length > 0;
  const migration = update.whatsNew?.migration ?? null;
  const backupChange = update.whatsNew?.backup_format_change ?? null;

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      await downloadBackupFile({ appVersion: APP_VERSION });
      setBackupExported(true);
    } finally {
      setExporting(false);
    }
  }

  const title = isBreaking
    ? update.promptVersion
      ? t('title_breaking', { version: update.promptVersion })
      : t('title_breaking_generic')
    : update.promptVersion
      ? t('title_with_version', { version: update.promptVersion })
      : t('title_generic');

  const HeaderIcon = isBreaking ? AlertTriangle : isMigration ? Package : Sparkles;
  // Tint the icon circle per risk so the visual cue lands before the
  // merchant reads the title.
  const iconClass = isBreaking
    ? 'bg-bad text-white'
    : isMigration
      ? 'bg-warn text-white'
      : 'bg-accent text-white';

  return (
    <Dialog.Root open>
      <Dialog.Portal>
        <Dialog.Overlay
          data-testid="app-update-overlay"
          className="fixed inset-0 z-40 bg-black/40"
        />
        <Dialog.Content
          data-testid="app-update-modal"
          data-risk-level={risk}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="bg-paper fixed inset-x-3 top-1/2 z-50 max-w-md -translate-y-1/2 rounded-2xl p-5 shadow-xl sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
        >
          <div className="flex items-start gap-3">
            <span
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${iconClass}`}
            >
              <HeaderIcon aria-hidden className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="flex flex-1 flex-col">
              <Dialog.Title
                data-testid="app-update-title"
                className="font-display text-ink text-lg font-semibold leading-tight"
              >
                {title}
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

          {risk === 'safe' ? (
            <SafeReassuranceBlock />
          ) : risk === 'migration' ? (
            <MigrationWarningBlock
              migration={migration}
              backupChange={backupChange}
              locale={locale}
            />
          ) : (
            <BreakingWarningBlock
              migration={migration}
              backupChange={backupChange}
              locale={locale}
            />
          )}

          {risk !== 'safe' ? (
            <ExportBackupBlock
              risk={risk}
              exporting={exporting}
              backupExported={backupExported}
              installing={installing}
              onExport={handleExport}
            />
          ) : null}

          <div className="mt-5 flex flex-col gap-2">
            {isBreaking ? (
              <>
                <button
                  type="button"
                  data-testid="app-update-cancel-breaking"
                  autoFocus
                  disabled={installing}
                  onClick={() => update.dismiss()}
                  className="bg-accent w-full rounded-xl py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {t('cancel_prepare_first')}
                </button>
                <button
                  type="button"
                  data-testid="app-update-install"
                  disabled={!backupExported || installing}
                  onClick={() => void update.installNow()}
                  className="border-hair w-full rounded-xl border bg-white py-2.5 text-sm font-medium text-ink disabled:opacity-50"
                >
                  {installing ? t('installing') : t('install_after_backup')}
                </button>
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SafeReassuranceBlock(): JSX.Element {
  const { t } = useTranslation('updates');
  return (
    <div
      data-testid="app-update-safe-reassurance"
      className="text-ink-2 mt-4 flex flex-col gap-1.5 text-xs"
    >
      <span className="inline-flex items-center gap-1.5">
        <Check aria-hidden className="text-ok h-3.5 w-3.5" strokeWidth={2.5} />
        {t('data_unaffected')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Check aria-hidden className="text-ok h-3.5 w-3.5" strokeWidth={2.5} />
        {t('backups_compatible')}
      </span>
    </div>
  );
}

function MigrationWarningBlock({
  migration,
  backupChange,
  locale,
}: {
  migration: MigrationInfo | null;
  backupChange: BackupFormatChange | null;
  locale: 'en' | 'fr' | 'ar';
}): JSX.Element {
  const { t } = useTranslation('updates');
  return (
    <div
      data-testid="app-update-migration-warning"
      className="border-warn bg-warn-soft mt-4 rounded-xl border-l-4 p-3"
    >
      <p className="text-ink font-medium text-sm leading-snug">{t('migration_heading')}</p>
      {migration ? (
        <>
          <p data-testid="app-update-migration-summary" className="text-ink-2 mt-1 text-sm">
            {migration.summary[locale]}
          </p>
          {migration.data_affected.length > 0 ? (
            <p data-testid="app-update-migration-affected" className="text-ink-3 mt-1 text-xs">
              {t('migration_affected', { tables: migration.data_affected.join(', ') })}
            </p>
          ) : null}
          {migration.data_preservation ? (
            <p className="text-ink-2 mt-1 text-xs">{migration.data_preservation}</p>
          ) : null}
        </>
      ) : null}
      {backupChange ? <BackupChangeLines change={backupChange} /> : null}
    </div>
  );
}

function BreakingWarningBlock({
  migration,
  backupChange,
  locale,
}: {
  migration: MigrationInfo | null;
  backupChange: BackupFormatChange | null;
  locale: 'en' | 'fr' | 'ar';
}): JSX.Element {
  const { t } = useTranslation('updates');
  return (
    <div
      data-testid="app-update-breaking-warning"
      className="border-bad bg-bad-soft mt-4 rounded-xl border-l-4 p-3"
    >
      <p className="text-ink font-semibold text-sm leading-snug">{t('breaking_heading')}</p>
      {migration ? (
        <>
          <p
            data-testid="app-update-migration-summary"
            className="text-ink mt-1 text-sm font-medium"
          >
            {migration.summary[locale]}
          </p>
          {migration.data_affected.length > 0 ? (
            <p data-testid="app-update-migration-affected" className="text-ink-3 mt-1 text-xs">
              {t('migration_affected', { tables: migration.data_affected.join(', ') })}
            </p>
          ) : null}
        </>
      ) : null}
      {backupChange ? <BackupChangeLines change={backupChange} prominent /> : null}
    </div>
  );
}

function BackupChangeLines({
  change,
  prominent,
}: {
  change: BackupFormatChange;
  prominent?: boolean;
}): JSX.Element {
  const { t } = useTranslation('updates');
  return (
    <div data-testid="app-update-backup-format-change" className="mt-2">
      <p className={`text-ink ${prominent ? 'text-sm font-medium' : 'text-xs'}`}>
        {t('backup_format_change', { from: change.from, to: change.to })}
      </p>
      {change.backwards_compatible_import ? (
        <p className="text-ink-3 mt-0.5 text-xs">{t('backup_format_old_importable')}</p>
      ) : null}
    </div>
  );
}

function ExportBackupBlock({
  risk,
  exporting,
  backupExported,
  installing,
  onExport,
}: {
  risk: 'migration' | 'breaking';
  exporting: boolean;
  backupExported: boolean;
  installing: boolean;
  onExport: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation('updates');
  const isBreaking = risk === 'breaking';
  return (
    <div data-testid="app-update-export-block" className="mt-4 flex flex-col gap-2">
      <p className="text-ink-2 text-xs leading-snug">
        {isBreaking ? t('breaking_export_required') : t('backup_tip')}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="app-update-export-backup"
          disabled={exporting || installing}
          onClick={() => void onExport()}
          className="border-accent text-accent inline-flex items-center justify-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          {t('export_backup_now')}
        </button>
        {backupExported ? (
          <span
            data-testid="app-update-backup-saved"
            className="text-ok inline-flex items-center gap-1 text-xs font-medium"
          >
            <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
            {t('backup_saved')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
