import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PhotoThumb } from '../components/photo-thumb';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { useInstallPrompt } from '../hooks/use-install-prompt';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { useLive } from '../hooks/use-live';
import {
  isAutoBackupSupported,
  pickAutoBackupFolder,
  setAutoBackupHandle,
} from '../utils/auto-backup';
import { getMeta, META_KEYS } from '../repos/meta';
import { db, resetDatabase } from '../db/db';
import { getProfile, upsertProfile, markBackedUp } from '../repos/profile';
import { storePhoto } from '../repos/photos';
import { exportBackupBlob, backupFilename } from '../backup/export';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { listSupportedCurrencies } from '../i18n/currency';
import { STORE_TYPES, STORE_TYPE_ORDER } from '../config/store-types';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../config/shop-subtypes';
import { ChevronRight, Download as DownloadIcon, Smartphone } from 'lucide-react';
import { type CurrencyCode, type Locale, type ShopSubtype, type StoreType } from '../types';

const APP_VERSION = '1.0.0';

const LANGUAGES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
];

export function SettingsScreen(): JSX.Element {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { t: tStoreTypes } = useTranslation('store_types');
  const { t: tShopSubtypes } = useTranslation('shop_subtypes');
  const { locale, setLocale } = useLocale();
  const profile = useProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [shopNameDraft, setShopNameDraft] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pendingCurrency, setPendingCurrency] = useState<CurrencyCode | null>(null);
  const [pendingStoreType, setPendingStoreType] = useState<StoreType | null>(null);
  // v0.5 ADR-017: shop sub-types editor. Draft is null until the user
  // toggles something — falling back to profile.shop_subtypes for render.
  // After Save, draft clears so the chips reflect the saved state again.
  const [subtypesDraft, setSubtypesDraft] = useState<ShopSubtype[] | null>(null);
  const [subtypesSavedAt, setSubtypesSavedAt] = useState<number | null>(null);
  const currencies = useMemo(() => listSupportedCurrencies(), []);
  const installState = useInstallPrompt();
  const autoBackupSupported = useMemo(() => isAutoBackupSupported(), []);
  const autoBackupFolder = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.auto_backup_folder_name)) ?? null,
    [],
    null,
  );
  const autoBackupAt = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.auto_backup_at)) ?? null,
    [],
    null,
  );

  async function setupAutoBackup(): Promise<void> {
    const picked = await pickAutoBackupFolder();
    if (!picked) return;
    await setAutoBackupHandle(db, picked.handle, picked.name);
  }

  async function disableAutoBackup(): Promise<void> {
    await setAutoBackupHandle(db, null, null);
  }

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
      // Honor the locale stored in the imported profile so the UI doesn't
      // stay in the previous language until the user reloads. 'replace'
      // overwrites profile entirely; 'merge' picks the row with the
      // greater updated_at — either way, getProfile() now returns the
      // post-import singleton, which is the locale we should switch to.
      const restored = await getProfile(db);
      if (restored?.locale && restored.locale !== locale) {
        await setLocale(restored.locale);
      }
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

  function pickLogoFile(): void {
    logoInputRef.current?.click();
  }

  async function handleLogoFile(file: File): Promise<void> {
    if (!profile) return;
    setLogoBusy(true);
    setLogoError(null);
    try {
      // Lazy-load the photo compressor (browser-image-compression is ~54 KB).
      // Keeps the initial Settings chunk small so the screen mounts fast.
      const { compressPhoto, PhotoTooLargeError } = await import('../utils/compress-photo');
      let compressed;
      try {
        compressed = await compressPhoto(file);
      } catch (err) {
        if (err instanceof PhotoTooLargeError) {
          setLogoError(t('logo_too_large'));
        } else {
          setLogoError(t('logo_failed'));
        }
        return;
      }
      const stored = await storePhoto(db, {
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      await upsertProfile(db, {
        name: profile.name,
        locale: profile.locale,
        logo_photo_id: stored.id,
      });
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function removeLogo(): Promise<void> {
    if (!profile) return;
    setLogoBusy(true);
    try {
      await upsertProfile(db, {
        name: profile.name,
        locale: profile.locale,
        logo_photo_id: null,
      });
    } finally {
      setLogoBusy(false);
    }
  }

  function selectCurrency(code: CurrencyCode): void {
    if (!profile || code === profile.currency) return;
    // Confirm before changing — switching does NOT rescale stored numbers.
    setPendingCurrency(code);
  }

  async function confirmCurrencyChange(): Promise<void> {
    if (!profile || !pendingCurrency) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      currency: pendingCurrency,
    });
    setPendingCurrency(null);
  }

  function selectStoreType(code: StoreType): void {
    if (!profile || code === profile.store_type) return;
    setPendingStoreType(code);
  }

  async function confirmStoreTypeChange(): Promise<void> {
    if (!profile || !pendingStoreType) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      store_type: pendingStoreType,
    });
    setPendingStoreType(null);
  }

  function toggleSubtype(st: ShopSubtype): void {
    const current = subtypesDraft ?? profile?.shop_subtypes ?? [];
    const next = current.includes(st) ? current.filter((s) => s !== st) : [...current, st];
    setSubtypesDraft(next);
    setSubtypesSavedAt(null);
  }

  async function saveSubtypes(): Promise<void> {
    if (!profile) return;
    const next = subtypesDraft ?? profile.shop_subtypes;
    if (next.length === 0) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      shop_subtypes: next,
    });
    setSubtypesDraft(null);
    setSubtypesSavedAt(Date.now());
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
          data-testid="section-shop-profile"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-3">{t('shop_profile')}</h3>

          <div className="flex items-center gap-3">
            <PhotoThumb
              photoId={profile?.logo_photo_id ?? null}
              size={56}
              testId="shop-logo-preview"
              className="rounded-full"
            />
            <div className="flex flex-1 flex-col gap-2">
              <button
                type="button"
                data-testid="shop-logo-pick"
                onClick={pickLogoFile}
                disabled={logoBusy}
                className="border-hair rounded-xl border bg-white py-2 text-sm disabled:opacity-50"
              >
                {profile?.logo_photo_id ? t('shop_logo_change') : t('shop_logo_add')}
              </button>
              {profile?.logo_photo_id ? (
                <button
                  type="button"
                  data-testid="shop-logo-remove"
                  onClick={() => void removeLogo()}
                  disabled={logoBusy}
                  className="text-bad border-bad/30 rounded-xl border bg-white py-2 text-sm disabled:opacity-50"
                >
                  {t('shop_logo_remove')}
                </button>
              ) : null}
            </div>
            <input
              ref={logoInputRef}
              data-testid="shop-logo-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleLogoFile(f);
              }}
            />
          </div>
          {logoError ? (
            <p
              data-testid="shop-logo-error"
              role="alert"
              className="text-bad bg-bad/5 border-bad/20 mt-2 rounded-xl border px-3 py-2 text-xs"
            >
              {logoError}
            </p>
          ) : null}

          <label htmlFor="settings-shop-name" className="text-ink-3 mt-4 mb-1 block text-xs">
            {t('shop_name')}
          </label>
          <input
            id="settings-shop-name"
            data-testid="shop-name-edit"
            type="text"
            value={shopNameDraft ?? profile?.name ?? ''}
            onChange={(e) => setShopNameDraft(e.target.value)}
            onBlur={() => void applyShopName()}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />

          <label htmlFor="settings-currency" className="text-ink-3 mt-4 mb-1 block text-xs">
            {t('currency')}
          </label>
          <select
            id="settings-currency"
            data-testid="settings-currency"
            value={profile?.currency ?? ''}
            onChange={(e) => selectCurrency(e.target.value)}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          >
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>

          {pendingCurrency ? (
            <div
              data-testid="currency-confirm"
              className="border-bad/30 mt-3 rounded-xl border bg-paper p-3"
            >
              <p className="text-sm">{t('currency_change_warning')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="currency-cancel"
                  onClick={() => setPendingCurrency(null)}
                  className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="button"
                  data-testid="currency-confirm-btn"
                  onClick={() => void confirmCurrencyChange()}
                  className="bg-ink flex-1 rounded-xl py-2.5 text-sm text-white"
                >
                  {tCommon('confirm')}
                </button>
              </div>
            </div>
          ) : null}

          <label htmlFor="settings-store-type" className="text-ink-3 mt-4 mb-1 block text-xs">
            {t('store_type')}
          </label>
          <select
            id="settings-store-type"
            data-testid="settings-store-type"
            value={profile?.store_type ?? ''}
            onChange={(e) => selectStoreType(e.target.value as StoreType)}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          >
            {STORE_TYPE_ORDER.map((code) => (
              <option key={code} value={code}>
                {tStoreTypes(STORE_TYPES[code].label_key)}
              </option>
            ))}
          </select>

          {pendingStoreType ? (
            <div
              data-testid="store-type-confirm"
              className="border-bad/30 mt-3 rounded-xl border bg-paper p-3"
            >
              <p className="text-sm">{t('store_type_change_warning')}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="store-type-cancel"
                  onClick={() => setPendingStoreType(null)}
                  className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
                >
                  {tCommon('cancel')}
                </button>
                <button
                  type="button"
                  data-testid="store-type-confirm-btn"
                  onClick={() => void confirmStoreTypeChange()}
                  className="bg-ink flex-1 rounded-xl py-2.5 text-sm text-white"
                >
                  {tCommon('confirm')}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {profile?.store_type === 'shop' ? (
          <section
            data-testid="section-shop-subtypes"
            className="border-hair rounded-2xl border bg-white p-4"
          >
            <h3 className="font-display text-base font-medium mb-1">{t('shop_subtypes_title')}</h3>
            <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('shop_subtypes_hint')}</p>

            <div data-testid="settings-subtypes" className="space-y-2">
              {SHOP_SUBTYPE_ORDER.map((st) => {
                const cfg = SHOP_SUBTYPE_CONFIG[st];
                const current = subtypesDraft ?? profile.shop_subtypes;
                const active = current.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    data-testid={`settings-subtype-${st}`}
                    onClick={() => toggleSubtype(st)}
                    aria-pressed={active}
                    className={`active:scale-[0.99] flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-all duration-200 ${
                      active
                        ? 'border-accent bg-accent-soft/40'
                        : 'border-hair bg-white hover:border-accent/40'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${
                        active ? 'border-accent bg-accent text-white' : 'border-hair bg-white'
                      }`}
                    >
                      {active ? '✓' : ''}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span className="text-ink text-sm font-medium leading-tight">
                        {tShopSubtypes(cfg.label_key)}
                      </span>
                      <span className="text-ink-3 mt-0.5 text-[11px] leading-snug">
                        {tShopSubtypes(cfg.desc_key)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {(subtypesDraft ?? profile.shop_subtypes).length === 0 ? (
              <p
                data-testid="settings-subtypes-min-one"
                className="text-bad mt-2 text-xs"
                role="alert"
              >
                {t('shop_subtypes_min_one')}
              </p>
            ) : null}

            <button
              type="button"
              data-testid="settings-subtypes-save"
              onClick={() => void saveSubtypes()}
              disabled={
                (subtypesDraft ?? profile.shop_subtypes).length === 0 || subtypesDraft === null
              }
              className="bg-ink mt-3 w-full rounded-xl py-2.5 text-sm text-white disabled:opacity-50"
            >
              {t('shop_subtypes_save')}
            </button>

            {subtypesSavedAt ? (
              <p data-testid="settings-subtypes-saved" className="text-ok mt-2 text-center text-xs">
                ✓ {t('shop_subtypes_saved')}
              </p>
            ) : null}
          </section>
        ) : null}

        <section
          data-testid="section-install"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-2">{t('install_section')}</h3>
          {installState.kind === 'installed' ? (
            <p data-testid="install-already" className="text-ok text-sm">
              ✓ {t('install_already')}
            </p>
          ) : installState.kind === 'installable' ? (
            <>
              <button
                type="button"
                data-testid="install-button"
                onClick={() => void installState.install()}
                className="bg-accent inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-white"
              >
                <DownloadIcon aria-hidden className="h-4 w-4" strokeWidth={2.5} />
                {t('install_button')}
              </button>
              <p className="text-ink-3 mt-2 text-xs leading-relaxed">{t('install_hint')}</p>
            </>
          ) : installState.kind === 'ios-instructions' ? (
            <div data-testid="install-ios" className="space-y-2">
              <div className="bg-paper-deep flex items-start gap-3 rounded-xl p-3">
                <Smartphone
                  aria-hidden
                  className="text-accent mt-0.5 h-5 w-5 flex-shrink-0"
                  strokeWidth={2}
                />
                <div>
                  <p className="text-ink text-sm font-medium">{t('install_ios_title')}</p>
                  <p className="text-ink-2 mt-1 text-xs leading-relaxed">
                    {t('install_ios_steps')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-ink-3 text-xs leading-relaxed">{t('install_unsupported')}</p>
          )}
        </section>

        <section
          data-testid="section-backup"
          className="border-hair rounded-2xl border bg-white p-4"
        >
          <h3 className="font-display text-base font-medium mb-1">{t('backup_section')}</h3>
          <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('backup_sync_hint')}</p>
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

          <div
            data-testid="auto-backup"
            className="border-hair mt-4 rounded-xl border bg-paper p-3"
          >
            <h4 className="text-ink text-sm font-medium">{t('auto_backup_title')}</h4>
            {!autoBackupSupported ? (
              <p className="text-ink-3 mt-2 text-xs leading-relaxed">
                {t('auto_backup_unsupported')}
              </p>
            ) : autoBackupFolder ? (
              <>
                <p className="text-ink-2 mt-1 truncate text-xs">📁 {autoBackupFolder}</p>
                <p className="text-ink-3 font-mono mt-1 text-[11px]">
                  {autoBackupAt
                    ? t('auto_backup_status_idle', { when: autoBackupAt })
                    : t('auto_backup_status_never')}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    data-testid="auto-backup-change"
                    onClick={() => void setupAutoBackup()}
                    className="border-hair flex-1 rounded-lg border bg-white py-2 text-xs"
                  >
                    {t('auto_backup_change')}
                  </button>
                  <button
                    type="button"
                    data-testid="auto-backup-disable"
                    onClick={() => void disableAutoBackup()}
                    className="text-bad border-bad/30 flex-1 rounded-lg border bg-white py-2 text-xs"
                  >
                    {t('auto_backup_disable')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-ink-3 mt-1 text-xs leading-relaxed">{t('auto_backup_hint')}</p>
                <button
                  type="button"
                  data-testid="auto-backup-pick"
                  onClick={() => void setupAutoBackup()}
                  className="bg-accent mt-2 w-full rounded-lg py-2 text-xs font-medium text-white"
                >
                  {t('auto_backup_pick')}
                </button>
              </>
            )}
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

        <section data-testid="section-help" className="border-hair rounded-2xl border bg-white p-4">
          <Link to="/help" data-testid="help-link" className="flex items-center justify-between">
            <h3 className="font-display text-base font-medium">{t('help')}</h3>
            <ChevronRight aria-hidden className="text-ink-3 h-5 w-5" strokeWidth={2} />
          </Link>
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
            <ChevronRight aria-hidden className="text-ink-3 h-5 w-5" strokeWidth={2} />
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
