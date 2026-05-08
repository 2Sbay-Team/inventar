import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { db, resetDatabase } from '../db/db';
import { upsertProfile, markBackedUp } from '../repos/profile';
import { exportBackupBlob, backupFilename } from '../backup/export';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { type Locale } from '../types';

const APP_VERSION = '1.0.0';

const LANGUAGES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
];

export function SettingsScreen(): JSX.Element {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { locale, setLocale } = useLocale();
  const profile = useProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [shopNameDraft, setShopNameDraft] = useState<string | null>(null);

  async function exportData(): Promise<void> {
    const { blob } = await exportBackupBlob(db, { appVersion: APP_VERSION });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    await markBackedUp(db);
  }

  function pickImportFile(): void {
    fileInputRef.current?.click();
  }

  async function readFile(file: File): Promise<void> {
    setImportError(null);
    const text = await file.text();
    setImportData(text);
  }

  async function applyImport(mode: 'replace' | 'merge'): Promise<void> {
    if (!importData) return;
    try {
      await importBackup({ data: importData, mode }, db);
      setImportData(null);
    } catch (e) {
      if (e instanceof BackupIntegrityError) setImportError(t('import_invalid'));
      else if (e instanceof BackupParseError) setImportError(t('import_invalid'));
      else throw e;
    }
  }

  async function resetEverything(): Promise<void> {
    await resetDatabase();
    window.location.replace('/');
  }

  async function applyShopName(): Promise<void> {
    if (shopNameDraft === null) return;
    if (shopNameDraft.trim().length < 2) return;
    await upsertProfile(db, { name: shopNameDraft.trim(), locale });
    setShopNameDraft(null);
  }

  return (
    <ScreenLayout>
      <ShopHeader />
      <main
        data-testid="settings-screen"
        className="flex flex-1 flex-col gap-4 px-5 py-4 overflow-y-auto"
      >
        <section
          data-testid="section-language"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-2">{t('language')}</h3>
          <div className="flex gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                data-testid={`settings-lang-${l.code}`}
                aria-pressed={locale === l.code}
                onClick={() => void setLocale(l.code)}
                className={`flex-1 rounded-xl border px-3 py-2.5 text-sm ${locale === l.code ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair bg-white'}`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section
          data-testid="section-shop-name"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-2">{t('shop_name')}</h3>
          <input
            data-testid="shop-name-edit"
            type="text"
            value={shopNameDraft ?? profile?.name ?? ''}
            onChange={(e) => setShopNameDraft(e.target.value)}
            onBlur={() => void applyShopName()}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
        </section>

        <section
          data-testid="section-backup"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-2">{t('backup_section')}</h3>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              data-testid="backup-export"
              onClick={() => void exportData()}
              className="border-hair rounded-xl border bg-white py-2.5 text-sm"
            >
              {t('backup_export')}
            </button>
            <button
              type="button"
              data-testid="backup-import"
              onClick={pickImportFile}
              className="border-hair rounded-xl border bg-white py-2.5 text-sm"
            >
              {t('backup_import')}
            </button>
            <input
              ref={fileInputRef}
              data-testid="import-input"
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void readFile(f);
              }}
            />
            <p data-testid="last-backup" className="text-ink-3 font-mono text-xs text-start mt-1">
              {t('backup_last')}: {profile?.last_backup_at ?? t('backup_never')}
            </p>
          </div>
          {importData ? (
            <div
              data-testid="import-prompt"
              className="border-hair mt-3 rounded-xl border bg-paper p-3"
            >
              <p className="text-sm">{t('import_question')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="import-replace"
                  onClick={() => void applyImport('replace')}
                  className="bg-ink flex-1 rounded-xl py-2.5 text-sm text-white"
                >
                  {t('import_replace')}
                </button>
                <button
                  type="button"
                  data-testid="import-merge"
                  onClick={() => void applyImport('merge')}
                  className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
                >
                  {t('import_merge')}
                </button>
              </div>
              {importError ? (
                <p data-testid="import-error" className="text-bad mt-2 text-xs">
                  {importError}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section
          data-testid="section-archive"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <Link
            to="/settings/archive"
            data-testid="archive-bin-link"
            className="flex items-center justify-between"
          >
            <h3 className="font-display text-base font-medium">{t('archive_bin')}</h3>
            <span aria-hidden className="text-ink-3 text-lg">
              ›
            </span>
          </Link>
        </section>

        <section data-testid="section-danger">
          <button
            type="button"
            data-testid="reset"
            onClick={() => setResetOpen(true)}
            className="text-bad border-bad/30 w-full rounded-xl border bg-white py-2.5 text-sm"
          >
            {t('reset')}
          </button>
        </section>

        {resetOpen ? (
          <div data-testid="reset-section" className="border-bad/30 rounded-xl border bg-white p-3">
            <p className="text-sm">{t('reset_title')}</p>
            <input
              data-testid="reset-input"
              type="text"
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              placeholder={t('reset_placeholder')}
              className="border-hair mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                data-testid="reset-cancel"
                onClick={() => {
                  setResetOpen(false);
                  setResetText('');
                }}
                className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                data-testid="reset-confirm"
                disabled={resetText !== 'CONFIRM'}
                onClick={() => void resetEverything()}
                className="bg-bad flex-1 rounded-xl py-2.5 text-sm text-white disabled:opacity-50"
              >
                {tCommon('confirm')}
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </ScreenLayout>
  );
}
