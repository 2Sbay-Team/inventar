import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  ChevronRight,
  FileUp,
  Footprints,
  Shirt,
  ShoppingCart,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AppFooter } from '../components/app-footer';
import { STORE_TYPES, STORE_TYPE_ORDER } from '../config/store-types';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../config/shop-subtypes';
import { db } from '../db/db';
import { DEFAULT_CURRENCY, DEFAULT_STORE_TYPE, getProfile, upsertProfile } from '../repos/profile';
import { storePhoto } from '../repos/photos';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { listSupportedCurrencies } from '../i18n/currency';
import { setLocale } from '../i18n/i18next';
import { useLocale } from '../hooks/use-locale';
import { ensurePersistence } from '../pwa/persistence';
import { type CurrencyCode, type Locale, type ShopSubtype, type StoreType } from '../types';

// Lucide replacements for the per-store-type emoji flags. Onboarding owns
// this mapping (rather than the data-only STORE_TYPES config) so the
// config can stay JSX-free and importable from non-React modules.
const STORE_TYPE_ICONS: Record<StoreType, LucideIcon> = {
  shoes: Footprints,
  clothes: Shirt,
  // v0.5 ADR-017: 'shop' replaces the legacy kiosk + grocery verticals.
  // The cart icon best evokes the merged "small minimarket" reference.
  shop: ShoppingCart,
};

interface LanguageOption {
  code: Locale;
  label: string;
  // Short uppercase badge (FR / AR / EN) shown in a rounded chip in
  // place of a country flag — Arabic is spoken across many countries
  // so a single flag misrepresents the language. Same treatment for
  // all three keeps things visually consistent.
  badge: string;
}

const LANGUAGE_OPTIONS: ReadonlyArray<LanguageOption> = [
  { code: 'fr', label: 'Français', badge: 'FR' },
  { code: 'ar', label: 'العربية', badge: 'AR' },
  { code: 'en', label: 'English', badge: 'EN' },
];

// SPEC §2.1 onboarding: language → shop name → "got it" backup card → land
// on the empty Search screen. Single screen with stepwise reveal. No network.
export function OnboardingScreen(): JSX.Element {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();

  const [step, setStep] = useState<
    'language' | 'intent' | 'name' | 'shop_subtypes' | 'backup_card'
  >('language');
  const [shopName, setShopName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [storeType, setStoreType] = useState<StoreType>(DEFAULT_STORE_TYPE);
  // v0.5 ADR-017: only consulted when storeType === 'shop'. Onboarding's
  // shop_subtypes step requires ≥1 selection before Continue enables.
  const [shopSubtypes, setShopSubtypes] = useState<ShopSubtype[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const currencies = listSupportedCurrencies();

  // Revoke any previous preview URL when the file changes / unmounts so we
  // don't leak object URLs on long onboarding sessions.
  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  function pickLogo(): void {
    logoInputRef.current?.click();
  }

  async function handleLogoFile(file: File): Promise<void> {
    setLogoBusy(true);
    setLogoError(null);
    try {
      // Lazy-load the compressor (browser-image-compression is ~54 KB) so
      // it only ships when a user actually picks a logo.
      const { compressPhoto, PhotoTooLargeError } = await import('../utils/compress-photo');
      let compressed;
      try {
        compressed = await compressPhoto(file);
      } catch (err) {
        if (err instanceof PhotoTooLargeError) {
          setLogoError(t('onboarding:logo_too_large'));
        } else {
          setLogoError(t('onboarding:logo_failed'));
        }
        return;
      }
      const compressedFile = new File([compressed.blob], 'logo.jpg', { type: compressed.mime });
      const url = URL.createObjectURL(compressedFile);
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoFile(compressedFile);
      setLogoPreview(url);
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  function clearLogo(): void {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview(null);
  }

  function pickLanguage(code: Locale): void {
    void setLocale(code);
    setStep('intent');
  }

  function pickImportFile(): void {
    setImportError(null);
    importInputRef.current?.click();
  }

  async function handleImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportError(null);
    try {
      const text = await file.text();
      // 'replace' wipes the empty fresh-install state so the imported
      // profile + articles + photos land cleanly. The OnboardingOnly
      // gate redirects to '/' on its own once useProfile() sees the
      // newly-written singleton row.
      await importBackup({ data: text, mode: 'replace' }, db);
      const restored = await getProfile(db);
      if (restored?.locale) {
        // Honor the locale the backup was created in — it usually
        // matches what the user is expecting from their previous setup.
        await setLocale(restored.locale);
      }
      await ensurePersistence(db);
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof BackupParseError || e instanceof BackupIntegrityError) {
        setImportError(t('onboarding:import_invalid'));
      } else {
        setImportError(t('onboarding:import_failed'));
      }
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  function submitName(): void {
    // Don't write the profile yet — once it exists, the OnboardingOnly gate
    // would yank the user off onto Search before they see the backup card.
    // Profile + persistence land on `confirmBackupCard` instead.
    if (shopName.trim().length < 2) return;
    // v0.5 ADR-017: shop vertical needs the merchant to pick ≥1 sub-type
    // before continuing — drives the default category list and the
    // dashboard widgets. Other verticals jump straight to the backup card.
    if (storeType === 'shop') {
      setStep('shop_subtypes');
    } else {
      setStep('backup_card');
    }
  }

  function toggleSubtype(st: ShopSubtype): void {
    setShopSubtypes((prev) => (prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]));
  }

  function confirmShopSubtypes(): void {
    if (shopSubtypes.length === 0) return;
    setStep('backup_card');
  }

  async function confirmBackupCard(): Promise<void> {
    setSubmitting(true);
    let logoPhotoId: string | null = null;
    if (logoFile) {
      // Read dimensions for the Photo row metadata. Cheap thanks to
      // createImageBitmap; we already shipped the blob through the
      // compressor so the size is bounded.
      const bitmap = await createImageBitmap(logoFile);
      const stored = await storePhoto(db, {
        blob: logoFile,
        width: bitmap.width,
        height: bitmap.height,
        mime: logoFile.type || 'image/jpeg',
      });
      bitmap.close?.();
      logoPhotoId = stored.id;
    }
    await upsertProfile(db, {
      name: shopName.trim(),
      locale,
      currency,
      store_type: storeType,
      // Empty array for non-shop verticals; shop merchants always have
      // ≥1 because the previous step required it.
      shop_subtypes: storeType === 'shop' ? shopSubtypes : [],
      logo_photo_id: logoPhotoId,
    });
    await ensurePersistence(db);
    setSubmitting(false);
    navigate('/', { replace: true });
  }

  return (
    <div className="bg-paper flex min-h-screen flex-col">
      <main
        data-testid="onboarding"
        className="mx-auto flex w-full flex-1 flex-col items-stretch justify-center px-6 py-12 min-[600px]:max-w-[540px] min-[768px]:max-w-[640px] min-[1024px]:max-w-[768px] min-[1280px]:max-w-[880px]"
      >
        {step === 'language' ? (
          <section data-testid="step-language" className="space-y-6">
            <div className="flex flex-col items-center text-center">
              <div className="bg-accent-soft text-accent mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
                <Boxes aria-hidden className="h-7 w-7" strokeWidth={2} />
              </div>
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:welcome_title')}
              </h1>
              <p className="text-ink-2 mt-3 max-w-md text-[15px] leading-relaxed">
                {t('onboarding:welcome_subtitle')}
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-ink-3 text-center text-xs uppercase tracking-widest">
                {t('onboarding:language_hint')}
              </p>
              {LANGUAGE_OPTIONS.map(({ code, label, badge }, i) => (
                <button
                  key={code}
                  type="button"
                  data-testid={`lang-${code}`}
                  onClick={() => pickLanguage(code)}
                  style={{ animationDelay: `${80 + i * 70}ms` }}
                  className="animate-onb-in border-hair hover:border-accent hover:bg-accent-soft/30 active:scale-[0.98] group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {/* Language code in a coral badge — same visual treatment
                      for FR / AR / EN. No country flags so a language
                      isn't tied to a single country (Arabic ≠ Tunisia). */}
                  <span
                    aria-hidden
                    className="bg-accent-soft text-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold tracking-wide"
                  >
                    {badge}
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-ink text-lg font-semibold leading-tight">{label}</span>
                    <span className="text-ink-3 text-xs">{t(`onboarding:lang_name_${code}`)}</span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="text-ink-4 group-hover:text-accent h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5"
                    strokeWidth={2.25}
                  />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 'intent' ? (
          <section data-testid="step-intent" className="space-y-6">
            <div className="text-center">
              <button
                type="button"
                data-testid="back-to-language"
                onClick={() => setStep('language')}
                className="text-ink-3 hover:text-accent mb-2 text-xs font-medium transition-colors"
              >
                {t('onboarding:change_language')}
              </button>
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:intent_title')}
              </h1>
              <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
                {t('onboarding:intent_subtitle')}
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                data-testid="intent-new"
                onClick={() => setStep('name')}
                disabled={importing}
                className="animate-onb-in border-hair hover:border-accent hover:bg-accent-soft/30 active:scale-[0.98] group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span
                  aria-hidden
                  className="bg-accent-soft text-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                >
                  <Sparkles className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-ink text-base font-semibold leading-tight">
                    {t('onboarding:intent_new')}
                  </span>
                  <span className="text-ink-3 mt-0.5 text-xs">
                    {t('onboarding:intent_new_desc')}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="text-ink-4 group-hover:text-accent h-4 w-4 rtl:rotate-180"
                  strokeWidth={2.25}
                />
              </button>

              <button
                type="button"
                data-testid="intent-import"
                onClick={pickImportFile}
                disabled={importing}
                className="animate-onb-in border-hair hover:border-accent hover:bg-accent-soft/30 active:scale-[0.98] group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.06)] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <span
                  aria-hidden
                  className="bg-accent-soft text-accent flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl"
                >
                  <FileUp className="h-5 w-5" strokeWidth={2} />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-ink text-base font-semibold leading-tight">
                    {importing ? t('onboarding:import_busy') : t('onboarding:intent_import')}
                  </span>
                  <span className="text-ink-3 mt-0.5 text-xs">
                    {t('onboarding:intent_import_desc')}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="text-ink-4 group-hover:text-accent h-4 w-4 rtl:rotate-180"
                  strokeWidth={2.25}
                />
              </button>

              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                data-testid="intent-import-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImportFile(f);
                }}
              />

              {importError ? (
                <p
                  data-testid="intent-import-error"
                  role="alert"
                  className="text-bad bg-bad/5 border-bad/20 rounded-xl border px-3 py-2 text-xs"
                >
                  {importError}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {step === 'name' ? (
          <section data-testid="step-name" className="space-y-6">
            <div className="text-center">
              <button
                type="button"
                data-testid="back-to-intent"
                onClick={() => setStep('intent')}
                className="text-ink-3 hover:text-accent mb-2 text-xs font-medium transition-colors"
              >
                ← {t('common:back')}
              </button>
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:setup_title')}
              </h1>
              <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
                {t('onboarding:setup_subtitle')}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-ink-2 text-sm font-medium">{t('onboarding:store_type_label')}</p>
              <div className="grid grid-cols-2 gap-3">
                {STORE_TYPE_ORDER.map((code, i) => {
                  const cfg = STORE_TYPES[code];
                  const Icon = STORE_TYPE_ICONS[code];
                  const active = storeType === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      data-testid={`onb-store-${code}`}
                      onClick={() => setStoreType(code)}
                      aria-pressed={active}
                      style={{ animationDelay: `${100 + i * 60}ms` }}
                      className={`animate-onb-in active:scale-[0.98] flex flex-col items-start gap-1.5 rounded-2xl border p-3.5 text-start shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        active
                          ? 'border-accent bg-accent-soft/40 shadow-[0_4px_14px_rgba(255,107,53,0.12)]'
                          : 'border-hair bg-white hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.05)]'
                      }`}
                    >
                      <span
                        className={`mb-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
                          active ? 'bg-accent text-white' : 'bg-paper-deep text-ink-2'
                        }`}
                      >
                        <Icon aria-hidden className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <span className="text-ink text-sm font-semibold leading-tight">
                        {t(`store_types:${cfg.label_key}`)}
                      </span>
                      <span className="text-ink-3 text-[11px] leading-snug">
                        {t(`store_types:${cfg.desc_key}`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-ink-2 text-sm font-medium">{t('onboarding:logo_label')}</p>
              <button
                type="button"
                data-testid="onb-logo-pick"
                onClick={pickLogo}
                disabled={logoBusy}
                aria-label={t('onboarding:logo_drop_zone')}
                className="border-hair hover:border-accent active:scale-[0.99] group relative flex h-32 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-white transition-all duration-300 hover:bg-accent-soft/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="text-ink-3 group-hover:text-accent flex flex-col items-center justify-center gap-2 transition-colors">
                    <span className="bg-paper-deep group-hover:bg-accent-soft flex h-10 w-10 items-center justify-center rounded-full transition-colors">
                      <Upload aria-hidden className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <span className="text-sm font-medium">{t('onboarding:logo_drop_zone')}</span>
                    <span className="text-ink-4 text-[11px]">{t('onboarding:logo_hint')}</span>
                  </div>
                )}
              </button>
              {logoFile ? (
                <button
                  type="button"
                  data-testid="onb-logo-clear"
                  onClick={clearLogo}
                  className="text-ink-3 hover:text-bad inline-flex items-center gap-1 text-xs"
                >
                  <X aria-hidden className="h-3 w-3" strokeWidth={2.5} />
                  {t('onboarding:logo_clear')}
                </button>
              ) : null}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleLogoFile(f);
                }}
              />
              {logoError ? (
                <p
                  data-testid="onb-logo-error"
                  role="alert"
                  className="text-bad bg-bad/5 border-bad/20 rounded-xl border px-3 py-2 text-xs"
                >
                  {logoError}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="onb-shop-name" className="text-ink-2 block text-sm font-medium">
                {t('onboarding:shop_name_label')}
              </label>
              <input
                id="onb-shop-name"
                data-testid="shop-name-input"
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder={t('onboarding:shop_name_placeholder')}
                maxLength={50}
                className="border-hair focus:border-accent w-full rounded-xl border bg-white px-4 py-3 text-base outline-none"
              />
              <p className="text-ink-3 text-xs">{t('onboarding:shop_name_min')}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="onb-currency" className="text-ink-2 block text-sm font-medium">
                {t('settings:currency')}
              </label>
              <select
                id="onb-currency"
                data-testid="onb-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="border-hair focus:border-accent w-full rounded-xl border bg-white px-4 py-3 text-base outline-none"
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <p className="text-ink-3 text-xs">{t('onboarding:pick_currency_hint')}</p>
            </div>

            <button
              type="button"
              data-testid="continue"
              disabled={shopName.trim().length < 2 || submitting}
              onClick={submitName}
              className="bg-accent w-full rounded-xl py-3 font-medium text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_6px_20px_rgba(255,107,53,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {t('common:continue')}
            </button>
          </section>
        ) : null}

        {step === 'shop_subtypes' ? (
          <section data-testid="step-shop-subtypes" className="space-y-6">
            <div className="text-center">
              <button
                type="button"
                data-testid="back-to-name"
                onClick={() => setStep('name')}
                className="text-ink-3 hover:text-accent mb-2 text-xs font-medium transition-colors"
              >
                ← {t('common:back')}
              </button>
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:subtypes_title')}
              </h1>
              <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
                {t('onboarding:subtypes_subtitle')}
              </p>
            </div>

            <div data-testid="onb-subtypes" className="space-y-2">
              {SHOP_SUBTYPE_ORDER.map((st, i) => {
                const cfg = SHOP_SUBTYPE_CONFIG[st];
                const active = shopSubtypes.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    data-testid={`onb-subtype-${st}`}
                    onClick={() => toggleSubtype(st)}
                    aria-pressed={active}
                    style={{ animationDelay: `${80 + i * 40}ms` }}
                    className={`animate-onb-in active:scale-[0.99] flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start shadow-[0_2px_6px_rgba(0,0,0,0.03)] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                      active
                        ? 'border-accent bg-accent-soft/40 shadow-[0_4px_14px_rgba(255,107,53,0.12)]'
                        : 'border-hair bg-white hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.05)]'
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
                      <span className="text-ink text-sm font-semibold leading-tight">
                        {t(`shop_subtypes:${cfg.label_key}`)}
                      </span>
                      <span className="text-ink-3 mt-0.5 text-[11px] leading-snug">
                        {t(`shop_subtypes:${cfg.desc_key}`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="text-ink-3 text-center text-[11px]">
              {t('onboarding:subtypes_min_hint')}
            </p>

            <button
              type="button"
              data-testid="continue"
              disabled={shopSubtypes.length === 0}
              onClick={confirmShopSubtypes}
              className="bg-accent w-full rounded-xl py-3 font-medium text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_6px_20px_rgba(255,107,53,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {t('common:continue')}
            </button>
          </section>
        ) : null}

        {step === 'backup_card' ? (
          <section data-testid="step-backup-card" className="space-y-5 text-center">
            <div className="bg-accent-soft text-accent mx-auto flex h-14 w-14 items-center justify-center rounded-2xl">
              <Boxes aria-hidden className="h-7 w-7" strokeWidth={2} />
            </div>
            <h2 className="font-display text-ink text-2xl font-semibold tracking-tight">
              {t('onboarding:backup_card_title')}
            </h2>
            <p className="text-ink-2 text-[15px] leading-relaxed">
              {t('onboarding:backup_card_body')}
            </p>
            <button
              type="button"
              data-testid="got-it"
              disabled={submitting}
              onClick={() => void confirmBackupCard()}
              className="bg-accent w-full rounded-xl py-3 font-medium text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_6px_20px_rgba(255,107,53,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {t('common:got_it')}
            </button>
          </section>
        ) : null}
      </main>
      <AppFooter />
    </div>
  );
}
