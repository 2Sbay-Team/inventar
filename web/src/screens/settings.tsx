import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PhotoThumb } from '../components/photo-thumb';
import { ScreenLayout } from '../components/screen-layout';
import { SelectWithCustom } from '../components/select-with-custom';
import { ShopHeader } from '../components/shop-header';
import { useInstallPrompt } from '../hooks/use-install-prompt';
import { useLocale } from '../hooks/use-locale';
import { useLocationLabels } from '../hooks/use-location-labels';
import { LOCATION_OPTIONS } from '../config/location-options';
import { useProfile } from '../hooks/use-profile';
import { useLive } from '../hooks/use-live';
import {
  isAutoBackupSupported,
  pickAutoBackupFolder,
  setAutoBackupHandle,
} from '../utils/auto-backup';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';
import { db, resetDatabase } from '../db/db';
import { getProfile, upsertProfile, markBackedUp } from '../repos/profile';
import { storePhoto } from '../repos/photos';
import { exportBackupBlob, backupFilename } from '../backup/export';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { listSupportedCurrencies } from '../i18n/currency';
import { STORE_TYPES, STORE_TYPE_ORDER } from '../config/store-types';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../config/shop-subtypes';
import { FASHION_SUBTYPE_CONFIG, FASHION_SUBTYPE_ORDER } from '../config/fashion-subtypes';
import { ChevronRight, Download as DownloadIcon, Smartphone } from 'lucide-react';
import {
  type CurrencyCode,
  type FashionSubtype,
  type Locale,
  type ShopSubtype,
  type StoreType,
} from '../types';

const EXPIRY_THRESHOLD_OPTIONS: readonly number[] = [3, 7, 14, 30];

// v0.5 ADR-018 (gap-fix opt-in): shop-only EAN strictness toggle.
// Default off — loose validation (12/13 digits, no checksum) covers
// the brief's test fixtures and most real Tunisian retail barcodes.
// On = strict EAN-13 checksum required (UPC-A is rejected too); the
// merchant flips this only if they're confident every item in their
// catalogue is a real EAN-13.
function EanStrictSection({ profileLoaded }: { profileLoaded: boolean }): JSX.Element | null {
  const { t } = useTranslation('settings');
  const stored = useLive<boolean>(
    async () => Boolean(await getMeta<boolean>(db, META_KEYS.ean_strict)),
    [profileLoaded],
    false,
  );
  async function toggle(): Promise<void> {
    await setMeta(db, META_KEYS.ean_strict, !stored);
  }
  if (!profileLoaded) return null;
  return (
    <section
      data-testid="section-ean-strict"
      className="border-hair rounded-2xl border bg-white p-4"
    >
      <h3 className="font-display text-base font-medium mb-1">{t('ean_strict_title')}</h3>
      <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('ean_strict_hint')}</p>
      <button
        type="button"
        data-testid="ean-strict-toggle"
        aria-pressed={stored}
        onClick={() => void toggle()}
        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
          stored ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair bg-white'
        }`}
      >
        <span
          aria-hidden
          className={`flex h-4 w-4 items-center justify-center rounded border-2 ${
            stored ? 'border-accent bg-accent text-white' : 'border-hair bg-white'
          }`}
        >
          {stored ? '✓' : ''}
        </span>
        {t('ean_strict_label')}
      </button>
    </section>
  );
}

// v0.5 ADR-019: shop-only Settings card. Reads/writes
// META_KEYS.expiry_threshold_days; default 7 if unset. The picker
// shows four chips. Saving writes immediately (no Save button) — the
// merchant's intent is unambiguous.
function ExpiryThresholdSection({ profileLoaded }: { profileLoaded: boolean }): JSX.Element | null {
  const { t } = useTranslation('settings');
  const stored = useLive<number>(
    async () => (await getMeta<number>(db, META_KEYS.expiry_threshold_days)) ?? 7,
    [profileLoaded],
    7,
  );
  const [pending, setPending] = useState<number | null>(null);
  const value = pending ?? stored;

  async function pick(n: number): Promise<void> {
    setPending(n);
    try {
      await setMeta(db, META_KEYS.expiry_threshold_days, n);
    } finally {
      // Once the meta write resolves, the live read picks up the new
      // value on the next tick — clear our optimistic override.
      setPending(null);
    }
  }

  if (!profileLoaded) return null;
  return (
    <section
      data-testid="section-expiry-threshold"
      className="border-hair rounded-2xl border bg-white p-4"
    >
      <h3 className="font-display text-base font-medium mb-1">{t('expiry_threshold_title')}</h3>
      <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('expiry_threshold_hint')}</p>
      <div data-testid="expiry-threshold-options" className="flex gap-2">
        {EXPIRY_THRESHOLD_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            data-testid={`expiry-threshold-${n}`}
            aria-pressed={value === n}
            onClick={() => void pick(n)}
            className={`flex-1 rounded-xl border px-3 py-2.5 text-sm ${
              value === n ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair bg-white'
            }`}
          >
            {t('expiry_threshold_unit', { n })}
          </button>
        ))}
      </div>
    </section>
  );
}

// v0.5.2 ADR-022: stock-locations editor. Two-input form for the
// merchant-customisable display labels. Immediate save (matches the
// expiry-threshold + sub-types editor pattern). Clearing a field falls
// back to the (vertical, locale) default at next render via the hook
// — see useLocationLabels.
function StockLocationsSection(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const profile = useProfile();
  const labels = useLocationLabels();
  if (!profile) return null;
  // v0.6 — the picker is the source of truth while open; commit
  // happens on every change (no separate draft + blur dance). Empty
  // values aren't reachable through SelectWithCustom (it reverts to
  // the first predefined option), but we still guard against them
  // before writing.
  async function commitFloor(value: string): Promise<void> {
    if (!profile) return;
    const trimmed = value.trim();
    if (trimmed === '') return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      location_floor_label: trimmed,
    });
  }
  async function commitBack(value: string): Promise<void> {
    if (!profile) return;
    const trimmed = value.trim();
    if (trimmed === '') return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      location_back_label: trimmed,
    });
  }
  return (
    <section
      data-testid="section-stock-locations"
      className="border-hair rounded-2xl border bg-white p-4"
    >
      <h3 className="font-display text-base font-medium mb-1">{t('locations_title')}</h3>
      <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('locations_hint')}</p>
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="settings-location-floor" className="text-ink-2 block text-xs font-medium">
            {t('location_floor_label')}
          </label>
          <SelectWithCustom
            id="settings-location-floor"
            testId="settings-location-floor"
            value={labels.floor}
            onChange={(v) => void commitFloor(v)}
            options={LOCATION_OPTIONS[profile.locale].floor}
            ariaLabel={t('location_floor_label')}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-location-back" className="text-ink-2 block text-xs font-medium">
            {t('location_back_label')}
          </label>
          <SelectWithCustom
            id="settings-location-back"
            testId="settings-location-back"
            value={labels.back}
            onChange={(v) => void commitBack(v)}
            options={LOCATION_OPTIONS[profile.locale].back}
            ariaLabel={t('location_back_label')}
          />
        </div>
      </div>
    </section>
  );
}

// v0.5.2.4 ADR-024 — invoicing / Facture fiscal block. Four optional
// fields that get baked into every issued invoice. All-or-nothing isn't
// enforced: a merchant who only fills in the legal name still gets a
// valid invoice (the missing fields just don't print). default_vat_pct
// is stored as integer percent for simplicity (no fractional VAT in any
// supported country yet); the per-invoice form lets the merchant
// override on a per-invoice basis.
function InvoicingSection(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const { t: tInvoice } = useTranslation('invoice');
  const profile = useProfile();
  const [legalNameDraft, setLegalNameDraft] = useState<string | null>(null);
  const [legalAddressDraft, setLegalAddressDraft] = useState<string | null>(null);
  const [fiscalIdDraft, setFiscalIdDraft] = useState<string | null>(null);
  const [vatDraft, setVatDraft] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  if (!profile) return null;
  const legalNameValue = legalNameDraft ?? profile.legal_name ?? '';
  const legalAddressValue = legalAddressDraft ?? profile.legal_address ?? '';
  const phoneValue = phoneDraft ?? profile.phone ?? '';
  const fiscalIdValue = fiscalIdDraft ?? profile.fiscal_id ?? '';
  const vatValue =
    vatDraft ?? (profile.default_vat_pct == null ? '' : String(profile.default_vat_pct));
  async function commit(
    patch:
      | { legal_name: string | null }
      | { legal_address: string | null }
      | { fiscal_id: string | null }
      | { default_vat_pct: number | null }
      | { phone: string | null },
  ): Promise<void> {
    if (!profile) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      ...patch,
    });
  }
  function trimToNullable(value: string): string | null {
    return value.trim() === '' ? null : value.trim();
  }
  function parseVat(value: string): number | null {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    // Reject NaN, negatives, and absurdly-high values. No country has
    // a VAT rate above 50% in practice.
    if (!Number.isFinite(n) || n < 0 || n > 50) return null;
    return Math.round(n);
  }
  return (
    <section
      data-testid="section-invoicing"
      className="border-hair rounded-2xl border bg-white p-4"
    >
      <h3 className="font-display mb-1 text-base font-medium">{t('invoicing_title')}</h3>
      <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('invoicing_hint')}</p>
      <div className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="settings-legal-name" className="text-ink-2 block text-xs font-medium">
            {t('invoicing_legal_name')}
          </label>
          <input
            id="settings-legal-name"
            data-testid="settings-legal-name"
            type="text"
            value={legalNameValue}
            placeholder={profile.name}
            onChange={(e) => setLegalNameDraft(e.target.value)}
            onBlur={(e) => {
              void commit({ legal_name: trimToNullable(e.target.value) });
              setLegalNameDraft(null);
            }}
            maxLength={120}
            className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-legal-address" className="text-ink-2 block text-xs font-medium">
            {t('invoicing_legal_address')}
          </label>
          <textarea
            id="settings-legal-address"
            data-testid="settings-legal-address"
            value={legalAddressValue}
            placeholder={t('invoicing_address_placeholder')}
            onChange={(e) => setLegalAddressDraft(e.target.value)}
            onBlur={(e) => {
              void commit({ legal_address: trimToNullable(e.target.value) });
              setLegalAddressDraft(null);
            }}
            rows={3}
            maxLength={300}
            className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-phone" className="text-ink-2 block text-xs font-medium">
            {t('invoicing_phone')}
          </label>
          <input
            id="settings-phone"
            data-testid="settings-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phoneValue}
            placeholder={t('invoicing_phone_placeholder')}
            onChange={(e) => setPhoneDraft(e.target.value)}
            onBlur={(e) => {
              void commit({ phone: trimToNullable(e.target.value) });
              setPhoneDraft(null);
            }}
            maxLength={40}
            className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            dir="ltr"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-fiscal-id" className="text-ink-2 block text-xs font-medium">
            {t('invoicing_fiscal_id')}
          </label>
          <input
            id="settings-fiscal-id"
            data-testid="settings-fiscal-id"
            type="text"
            value={fiscalIdValue}
            placeholder={t('invoicing_fiscal_id_placeholder')}
            onChange={(e) => setFiscalIdDraft(e.target.value)}
            onBlur={(e) => {
              void commit({ fiscal_id: trimToNullable(e.target.value) });
              setFiscalIdDraft(null);
            }}
            maxLength={40}
            className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            dir="ltr"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-default-vat" className="text-ink-2 block text-xs font-medium">
            {t('invoicing_default_vat')}
          </label>
          <input
            id="settings-default-vat"
            data-testid="settings-default-vat"
            type="number"
            inputMode="numeric"
            min={0}
            max={50}
            step={1}
            value={vatValue}
            placeholder="19"
            onChange={(e) => setVatDraft(e.target.value)}
            onBlur={(e) => {
              void commit({ default_vat_pct: parseVat(e.target.value) });
              setVatDraft(null);
            }}
            className="border-hair focus-visible:ring-accent/40 w-32 rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
            dir="ltr"
          />
          <p className="text-ink-3 text-xs">{t('invoicing_default_vat_hint')}</p>
        </div>
        <Link
          to="/invoices"
          data-testid="settings-past-invoices"
          className="text-accent inline-flex items-center text-sm font-medium"
        >
          {tInvoice('past_invoices_link')}
        </Link>
      </div>
    </section>
  );
}

// v0.5.1: SW kill-switch. The most likely cause of "the app won't open
// on my phone" reports is a stale precached service worker that's
// serving a broken old shell — workbox's clientsClaim/skipWaiting take
// effect on the next page load, but if that load itself crashes the
// merchant has no way out. This section gives them one. We unregister
// every SW + delete every Cache Storage bucket + reload. IndexedDB is
// deliberately untouched: this is "drop the cache", not "reset the
// app" (the destructive option already exists below).
function MaintenanceSection(): JSX.Element {
  const { t } = useTranslation('settings');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [working, setWorking] = useState(false);

  async function clearCachesAndReload(): Promise<void> {
    setWorking(true);
    try {
      // Unregister every controller registered for this scope.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      // Drop the workbox precache + any runtime caches.
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      // Best-effort. If something fails we still want the reload to
      // happen — at minimum the merchant gets a fresh network fetch.
      console.error('clear cache failed', e);
    }
    // Hard reload so the freshly-installing SW (if any) doesn't keep
    // serving the old shell.
    window.location.reload();
  }

  return (
    <section
      data-testid="section-maintenance"
      className="border-hair rounded-2xl border bg-white p-4"
    >
      <h3 className="font-display text-base font-medium mb-1">{t('maintenance_title')}</h3>
      <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('maintenance_hint')}</p>
      <button
        type="button"
        data-testid="clear-cache"
        onClick={() => setConfirmOpen(true)}
        className="border-hair w-full rounded-xl border bg-white py-2.5 text-sm"
      >
        {t('clear_cache_btn')}
      </button>
      {confirmOpen ? (
        <div
          data-testid="clear-cache-confirm"
          className="border-hair mt-2 rounded-xl border bg-white p-3"
        >
          <p className="text-sm">{t('clear_cache_confirm_body')}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid="clear-cache-cancel"
              onClick={() => setConfirmOpen(false)}
              disabled={working}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {t('clear_cache_cancel')}
            </button>
            <button
              type="button"
              data-testid="clear-cache-confirm-btn"
              onClick={() => void clearCachesAndReload()}
              disabled={working}
              className="bg-accent text-accent-ink flex-1 rounded-xl py-2.5 text-sm"
            >
              {working ? t('clear_cache_working') : t('clear_cache_confirm_yes')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

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
  const { t: tFashionSubtypes } = useTranslation('fashion_subtypes');
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
  // v0.5.1: shop sub-types editor saves immediately on toggle (no
  // draft state, no Save button) — matches the expiry-threshold and
  // EAN-strict toggles. The trade-off is one IDB write per chip tap;
  // at 8 chips that's bounded and fine.
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

  // v0.5.1: immediate save on toggle (no draft / no Save button).
  // Validation: the merchant can't end up with zero sub-types — the
  // last selected chip can't be deselected. Onboarding enforces ≥1
  // at creation; Settings preserves that invariant.
  async function toggleSubtype(st: ShopSubtype): Promise<void> {
    if (!profile) return;
    const current = profile.shop_subtypes;
    const wouldRemove = current.includes(st);
    if (wouldRemove && current.length === 1) return;
    const next = wouldRemove ? current.filter((s) => s !== st) : [...current, st];
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      shop_subtypes: next,
    });
  }

  // v0.5.2.7: same toggle pattern for the fashion vertical. Without
  // this, a merchant who picked only `shoes` at onboarding had no way
  // to later add clothing_men / clothing_women etc. — and therefore no
  // access to the letter-size autocomplete (XS / S / M / L / XL ...).
  async function toggleFashionSubtype(st: FashionSubtype): Promise<void> {
    if (!profile) return;
    const current = profile.fashion_subtypes;
    const wouldRemove = current.includes(st);
    if (wouldRemove && current.length === 1) return;
    const next = wouldRemove ? current.filter((s) => s !== st) : [...current, st];
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      fashion_subtypes: next,
    });
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
                const active = profile.shop_subtypes.includes(st);
                const isLastSelected = active && profile.shop_subtypes.length === 1;
                return (
                  <button
                    key={st}
                    type="button"
                    data-testid={`settings-subtype-${st}`}
                    onClick={() => void toggleSubtype(st)}
                    disabled={isLastSelected}
                    aria-pressed={active}
                    title={isLastSelected ? t('shop_subtypes_min_one') : undefined}
                    className={`active:scale-[0.99] flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-80 ${
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
            <p className="text-ink-3 mt-2 text-[11px]">{t('shop_subtypes_min_one')}</p>
          </section>
        ) : null}

        {profile?.store_type === 'fashion' ? (
          <section
            data-testid="section-fashion-subtypes"
            className="border-hair rounded-2xl border bg-white p-4"
          >
            <h3 className="font-display text-base font-medium mb-1">
              {t('fashion_subtypes_title')}
            </h3>
            <p className="text-ink-3 mb-3 text-xs leading-relaxed">{t('fashion_subtypes_hint')}</p>
            <div data-testid="settings-fashion-subtypes" className="space-y-2">
              {FASHION_SUBTYPE_ORDER.map((st) => {
                const cfg = FASHION_SUBTYPE_CONFIG[st];
                const active = profile.fashion_subtypes.includes(st);
                const isLastSelected = active && profile.fashion_subtypes.length === 1;
                return (
                  <button
                    key={st}
                    type="button"
                    data-testid={`settings-fashion-subtype-${st}`}
                    onClick={() => void toggleFashionSubtype(st)}
                    disabled={isLastSelected}
                    aria-pressed={active}
                    title={isLastSelected ? t('fashion_subtypes_min_one') : undefined}
                    className={`active:scale-[0.99] flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-80 ${
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
                        {tFashionSubtypes(cfg.label_key)}
                      </span>
                      <span className="text-ink-3 mt-0.5 text-[11px] leading-snug">
                        {tFashionSubtypes(cfg.desc_key)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-ink-3 mt-2 text-[11px]">{t('fashion_subtypes_min_one')}</p>
          </section>
        ) : null}

        {profile?.store_type === 'shop' ? (
          <ExpiryThresholdSection profileLoaded={Boolean(profile)} />
        ) : null}

        {profile?.store_type === 'shop' ? (
          <EanStrictSection profileLoaded={Boolean(profile)} />
        ) : null}

        {/* v0.5.2.7: surfaced Invoicing higher in the list — merchants
            reported they couldn't find legal name / address / fiscal ID /
            VAT or the Past Invoices link when these lived at the bottom
            of Settings. */}
        <InvoicingSection />

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

        <StockLocationsSection />

        <MaintenanceSection />

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
