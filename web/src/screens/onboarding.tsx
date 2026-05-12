import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Boxes,
  ChevronRight,
  FileUp,
  Footprints,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AppFooter } from '../components/app-footer';
import { LogoPreviewDialog } from '../components/logo-preview-dialog';
import { SelectWithCustom } from '../components/select-with-custom';
import { STORE_TYPES, STORE_TYPE_ORDER } from '../config/store-types';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../config/shop-subtypes';
import { FASHION_SUBTYPE_CONFIG, FASHION_SUBTYPE_ORDER } from '../config/fashion-subtypes';
import {
  LOCATION_OPTIONS,
  LOCATION_PICKER_DEFAULTS,
  normaliseBackLabel,
  normaliseFrontLabel,
} from '../config/location-options';
import { defaultLocationLabels } from '../db/migrate-v8-to-v9';
import { db } from '../db/db';
import { META_KEYS, setMeta } from '../repos/meta';
import { DEFAULT_CURRENCY, DEFAULT_STORE_TYPE, getProfile, upsertProfile } from '../repos/profile';
import { storePhoto } from '../repos/photos';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { listSupportedCurrencies } from '../i18n/currency';
import { setLocale } from '../i18n/i18next';
import { useLocale } from '../hooks/use-locale';
import { ensurePersistence } from '../pwa/persistence';
import {
  type CurrencyCode,
  type FashionSubtype,
  type Locale,
  type ShopSubtype,
  type StoreType,
} from '../types';

// Lucide replacements for the per-store-type emoji flags. Onboarding owns
// this mapping (rather than the data-only STORE_TYPES config) so the
// config can stay JSX-free and importable from non-React modules.
const STORE_TYPE_ICONS: Record<StoreType, LucideIcon> = {
  // v0.5.2 ADR-021: 'fashion' replaces the legacy shoes + clothes
  // verticals. The shopping-bag icon evokes the merged boutique flow.
  fashion: ShoppingBag,
  // v0.5 ADR-017: 'shop' replaces the legacy kiosk + grocery verticals.
  // The cart icon best evokes the merged "small minimarket" reference.
  shop: ShoppingCart,
  // Legacy entries kept so any read against an un-migrated profile
  // doesn't crash the picker. Onboarding's STORE_TYPE_ORDER no longer
  // includes them.
  shoes: Footprints,
  clothes: Shirt,
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
    | 'language'
    | 'intent'
    | 'name'
    | 'shop_subtypes'
    | 'fashion_subtypes'
    | 'locations'
    | 'backup_card'
  >('language');
  const [shopName, setShopName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [storeType, setStoreType] = useState<StoreType>(DEFAULT_STORE_TYPE);
  // v0.5 ADR-017: only consulted when storeType === 'shop'. Onboarding's
  // shop_subtypes step requires ≥1 selection before Continue enables.
  const [shopSubtypes, setShopSubtypes] = useState<ShopSubtype[]>([]);
  // v0.5.2 ADR-021: fashion-vertical analogue of shopSubtypes. Required
  // selection (≥1) when storeType === 'fashion'.
  //
  // v0.5.6 (Issue 7) — new profiles START with zero sub-types ticked.
  // The merchant must explicitly pick at least one; Continue is gated
  // on `fashionSubtypes.length === 0`. Migrated profiles never hit
  // this state — they go through /migrations/confirm-subtypes where
  // the v8→v9-assigned sub-types are pre-ticked from the profile row.
  const [fashionSubtypes, setFashionSubtypes] = useState<FashionSubtype[]>([]);
  // v0.5.2 ADR-022: location labels. Defaults are computed lazily from
  // (storeType, locale) so a vertical or locale change re-derives them
  // (the merchant hasn't typed anything yet).
  const [locationFloorLabel, setLocationFloorLabel] = useState<string>('');
  const [locationBackLabel, setLocationBackLabel] = useState<string>('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  // v0.5.4 ADR-028 — keying preview state. When the util produces a
  // candidate, render LogoPreviewDialog and let the merchant choose
  // before we commit to setLogoFile. Cleared on close.
  const [logoKeyingCandidate, setLogoKeyingCandidate] = useState<{
    originalBlob: Blob;
    keyedBlob: Blob;
  } | null>(null);
  const [logoToast, setLogoToast] = useState<string | null>(null);
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
    setLogoToast(null);
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
      // v0.5.4 ADR-028 — try the keying util. Three outcomes:
      //   keyed → open the preview Dialog (caller picks)
      //   skipped → commit the original silently
      //   rejected (render-error or all-transparent) → toast +
      //     fall back to the original blob
      const { analyseLogoForKeying } = await import('../utils/logo-transparency');
      const outcome = await analyseLogoForKeying({
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      if (outcome.kind === 'keyed') {
        setLogoKeyingCandidate({ originalBlob: compressed.blob, keyedBlob: outcome.keyedBlob });
        return;
      }
      if (outcome.kind === 'rejected') {
        if (outcome.reason === 'all-transparent') {
          setLogoError(t('logo:too_much_background'));
          return;
        }
        setLogoToast(t('logo:removal_failed_toast'));
      }
      // skipped or fall-through rejection → commit the original blob.
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

  // v0.5.4 — invoked when the merchant picks an option in the
  // LogoPreviewDialog. Both branches store the chosen blob as the
  // logo File; mime stays application-friendly (image/png for the
  // keyed branch, image/jpeg for the original).
  function commitLogoChoice(choice: { blob: Blob; kind: 'transparent' | 'original' }): void {
    const mime = choice.kind === 'transparent' ? 'image/png' : 'image/jpeg';
    const ext = choice.kind === 'transparent' ? 'png' : 'jpg';
    const fileName = `logo.${ext}`;
    const file = new File([choice.blob], fileName, { type: mime });
    const url = URL.createObjectURL(file);
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(url);
    setLogoKeyingCandidate(null);
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
    // v0.5 ADR-017 / v0.5.2 ADR-021: each vertical has its own subtypes
    // step. Both require ≥1 selection. Then proceed to locations.
    if (storeType === 'shop') {
      setStep('shop_subtypes');
    } else if (storeType === 'fashion') {
      setStep('fashion_subtypes');
    } else {
      // Legacy verticals (shoes / clothes) — should never hit this branch
      // post-v9 since STORE_TYPE_ORDER is fashion+shop, but keep a safe
      // fallback so a manually-set legacy storeType still completes.
      setStep('locations');
    }
  }

  function toggleSubtype(st: ShopSubtype): void {
    setShopSubtypes((prev) => (prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]));
  }

  function toggleFashionSubtype(st: FashionSubtype): void {
    setFashionSubtypes((prev) =>
      prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st],
    );
  }

  function confirmShopSubtypes(): void {
    if (shopSubtypes.length === 0) return;
    setStep('locations');
  }

  function confirmFashionSubtypes(): void {
    if (fashionSubtypes.length === 0) return;
    setStep('locations');
  }

  function confirmLocations(): void {
    setStep('backup_card');
  }

  // v0.6 ADR-029 — when the merchant lands on the locations step, pre-fill
  // the dropdown with the per-locale defaults. The picker uses the same
  // option list for both verticals (per the v0.6 brief); the v8→v9
  // migration's vertical-specific defaults still seed the field for
  // pre-existing profiles via defaultLocationLabels (used by
  // useLocationLabels), but the *picker* UI is locale-only.
  useEffect(() => {
    if (step !== 'locations') return;
    const defaults = LOCATION_PICKER_DEFAULTS[locale];
    if (locationFloorLabel.trim() === '') setLocationFloorLabel(defaults.floor);
    if (locationBackLabel.trim() === '') setLocationBackLabel(defaults.back);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, locale]);

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
    // Resolve location labels. The picker normally guarantees a non-empty
    // value, but the legacy-vertical-fallback path (a v6 profile that
    // bypasses the locations step entirely) still benefits from the
    // (vertical, locale) defaults used by the v8→v9 migration.
    const verticalForLabels: 'fashion' | 'shop' = storeType === 'shop' ? 'shop' : 'fashion';
    const labelDefaults =
      locationFloorLabel.trim() === '' || locationBackLabel.trim() === ''
        ? defaultLocationLabels(verticalForLabels, locale)
        : { floor: '', back: '' };
    const finalFloorLabel =
      locationFloorLabel.trim() === '' ? labelDefaults.floor : locationFloorLabel.trim();
    const finalBackLabel =
      locationBackLabel.trim() === '' ? labelDefaults.back : locationBackLabel.trim();
    // v0.6.3 — onboarding state holds display strings (the
    // SelectWithCustom contract), but persistence uses canonical
    // keys. normaliseFrontLabel / normaliseBackLabel map a known
    // display to its FrontKey/BackKey, or wrap a typed-custom
    // value with the `custom:` sentinel.
    await upsertProfile(db, {
      name: shopName.trim(),
      locale,
      currency,
      store_type: storeType,
      // Empty array for non-shop verticals; shop merchants always have
      // ≥1 because the previous step required it.
      shop_subtypes: storeType === 'shop' ? shopSubtypes : [],
      // v0.5.2 ADR-021: same shape for fashion. ≥1 enforced upstream.
      fashion_subtypes: storeType === 'fashion' ? fashionSubtypes : [],
      location_floor_label: normaliseFrontLabel(finalFloorLabel),
      location_back_label: normaliseBackLabel(finalBackLabel),
      logo_photo_id: logoPhotoId,
    });
    // v0.5.2 ADR-021: a fresh-onboarded profile picked its own
    // subtypes — the migration confirmation banner should never show
    // for them. Stamp confirmed_at so the banner-detection logic
    // skips this profile.
    await setMeta(db, META_KEYS.migration_v9_subtypes_confirmed_at, new Date().toISOString());
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
                // v0.6.3 ADR-028 follow-up — when a logo has been
                // committed (keyed PNG or kept-original JPEG), drop
                // `bg-white` so a transparent-PNG logo isn't shown
                // sitting on a white square. The dashed-border drop-
                // zone keeps `bg-white` only in the empty state, where
                // it backs the Upload icon. object-contain (vs cover)
                // letterboxes non-square logos instead of cropping the
                // edges off the merchant's mark.
                className={`border-hair hover:border-accent active:scale-[0.99] group relative flex h-32 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  logoPreview ? '' : 'bg-white hover:bg-accent-soft/20'
                }`}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="" className="h-full w-full object-contain" />
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
              {logoToast ? (
                <p
                  data-testid="onb-logo-toast"
                  role="status"
                  className="text-ink-3 bg-paper-deep border-hair rounded-xl border px-3 py-2 text-xs"
                >
                  {logoToast}
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
          <SubtypesStep
            kind="shop"
            selected={shopSubtypes}
            onToggle={toggleSubtype}
            onAddCustom={(value) => setShopSubtypes((prev) => [...prev, value])}
            onRemoveCustom={(value) => setShopSubtypes((prev) => prev.filter((s) => s !== value))}
            onBack={() => setStep('name')}
            onContinue={confirmShopSubtypes}
            t={t}
          />
        ) : null}

        {step === 'fashion_subtypes' ? (
          <SubtypesStep
            kind="fashion"
            selected={fashionSubtypes}
            onToggle={toggleFashionSubtype}
            onAddCustom={(value) => setFashionSubtypes((prev) => [...prev, value])}
            onRemoveCustom={(value) =>
              setFashionSubtypes((prev) => prev.filter((s) => s !== value))
            }
            onBack={() => setStep('name')}
            onContinue={confirmFashionSubtypes}
            t={t}
          />
        ) : null}

        {step === 'locations' ? (
          <section data-testid="step-locations" className="space-y-6">
            <div className="text-center">
              <button
                type="button"
                data-testid="back-to-subtypes"
                onClick={() => setStep(storeType === 'shop' ? 'shop_subtypes' : 'fashion_subtypes')}
                className="text-ink-3 hover:text-accent mb-2 text-xs font-medium transition-colors"
              >
                ← {t('common:back')}
              </button>
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:locations_title')}
              </h1>
              <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
                {t('onboarding:locations_subtitle')}
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="onb-location-floor"
                  className="text-ink-2 block text-sm font-medium"
                >
                  {t('onboarding:location_floor_label')}
                </label>
                <SelectWithCustom
                  id="onb-location-floor"
                  testId="onb-location-floor"
                  value={locationFloorLabel}
                  onChange={setLocationFloorLabel}
                  options={LOCATION_OPTIONS[locale].floor}
                  ariaLabel={t('onboarding:location_floor_label')}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="onb-location-back" className="text-ink-2 block text-sm font-medium">
                  {t('onboarding:location_back_label')}
                </label>
                <SelectWithCustom
                  id="onb-location-back"
                  testId="onb-location-back"
                  value={locationBackLabel}
                  onChange={setLocationBackLabel}
                  options={LOCATION_OPTIONS[locale].back}
                  ariaLabel={t('onboarding:location_back_label')}
                />
              </div>
              <p className="text-ink-3 text-[11px]">{t('onboarding:locations_hint')}</p>
            </div>

            <button
              type="button"
              data-testid="continue"
              onClick={confirmLocations}
              className="bg-accent w-full rounded-xl py-3 font-medium text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_6px_20px_rgba(255,107,53,0.35)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
      {logoKeyingCandidate ? (
        <LogoPreviewDialog
          open
          originalBlob={logoKeyingCandidate.originalBlob}
          keyedBlob={logoKeyingCandidate.keyedBlob}
          onChoose={commitLogoChoice}
          onCancel={() => setLogoKeyingCandidate(null)}
        />
      ) : null}
    </div>
  );
}

// v0.5 ADR-017 / v0.5.2 ADR-018: subtype picker shared between the
// shop and fashion onboarding steps. Uses different config maps + i18n
// namespaces depending on `kind`. The custom-subtype affordance lives
// here too: an inline "+ Add another category" chip that replaces
// itself with a small text input on tap. Custom strings are stored
// verbatim in the selected array (max 30 chars per ADR-018).
interface SubtypesStepProps {
  kind: 'shop' | 'fashion';
  selected: string[];
  onToggle: (st: string) => void;
  onAddCustom: (value: string) => void;
  onRemoveCustom: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
  t: (k: string) => string;
}

const CUSTOM_SUBTYPE_MAX = 30;

function SubtypesStep(props: SubtypesStepProps): JSX.Element {
  const { kind, selected, onToggle, onAddCustom, onRemoveCustom, onBack, onContinue, t } = props;
  const [customDraft, setCustomDraft] = useState('');
  const [customMode, setCustomMode] = useState<'idle' | 'editing'>('idle');

  const order = kind === 'shop' ? SHOP_SUBTYPE_ORDER : FASHION_SUBTYPE_ORDER;
  const config = kind === 'shop' ? SHOP_SUBTYPE_CONFIG : FASHION_SUBTYPE_CONFIG;
  const ns = kind === 'shop' ? 'shop_subtypes' : 'fashion_subtypes';
  const stepTestId = kind === 'shop' ? 'step-shop-subtypes' : 'step-fashion-subtypes';
  const subtypeTestPrefix = 'onb-subtype';

  function commitCustom(): void {
    const value = customDraft.trim();
    if (value.length === 0 || value.length > CUSTOM_SUBTYPE_MAX) return;
    // Avoid duplicates: a custom string already in `selected` (or one
    // that collides with a predefined key) does nothing — the chip is
    // already visible.
    if (selected.includes(value)) {
      setCustomDraft('');
      setCustomMode('idle');
      return;
    }
    onAddCustom(value);
    setCustomDraft('');
    setCustomMode('idle');
  }

  // Custom strings are anything in `selected` that isn't in the
  // predefined order (legacy keys, e.g. tobacco_lottery on existing
  // shop profiles, ALSO render here — they're stored as 'set' but
  // not in the picker order. The merchant can remove them via the
  // remove-x affordance just like any custom).
  const customSelected = selected.filter((s) => !(order as readonly string[]).includes(s));

  return (
    <section data-testid={stepTestId} className="space-y-6">
      <div className="text-center">
        <button
          type="button"
          data-testid="back-to-name"
          onClick={onBack}
          className="text-ink-3 hover:text-accent mb-2 text-xs font-medium transition-colors"
        >
          ← {t('common:back')}
        </button>
        <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
          {t(`onboarding:${kind}_subtypes_title`)}
        </h1>
        <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
          {t(`onboarding:${kind}_subtypes_subtitle`)}
        </p>
      </div>

      <div data-testid="onb-subtypes" className="space-y-2">
        {order.map((st, i) => {
          const cfg = (config as Record<string, { label_key: string; desc_key: string }>)[st];
          const active = selected.includes(st);
          return (
            <button
              key={st}
              type="button"
              data-testid={`${subtypeTestPrefix}-${st}`}
              onClick={() => onToggle(st)}
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
                  {t(`${ns}:${cfg.label_key}`)}
                </span>
                <span className="text-ink-3 mt-0.5 text-[11px] leading-snug">
                  {t(`${ns}:${cfg.desc_key}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* v0.5.2 ADR-018: custom subtypes. Anything the merchant types
          here joins `selected` verbatim. Already-selected customs
          (and legacy keys read from existing profiles) render below
          as removable chips. */}
      {customSelected.length > 0 ? (
        <div data-testid="onb-custom-chips" className="flex flex-wrap gap-2">
          {customSelected.map((value) => (
            <span
              key={value}
              data-testid={`onb-custom-chip-${value}`}
              className="border-accent bg-accent-soft text-accent-ink inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium"
            >
              {value}
              <button
                type="button"
                data-testid={`onb-custom-remove-${value}`}
                onClick={() => onRemoveCustom(value)}
                aria-label={t('common:close')}
                className="text-accent-ink/70 hover:text-accent-ink"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {customMode === 'idle' ? (
        <button
          type="button"
          data-testid="onb-custom-add"
          onClick={() => setCustomMode('editing')}
          className="border-hair text-ink-2 hover:border-accent/40 inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-xs font-medium"
        >
          + {t('onboarding:subtypes_custom_add')}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            data-testid="onb-custom-input"
            autoFocus
            type="text"
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCustom();
              if (e.key === 'Escape') {
                setCustomDraft('');
                setCustomMode('idle');
              }
            }}
            maxLength={CUSTOM_SUBTYPE_MAX}
            placeholder={t('onboarding:subtypes_custom_placeholder')}
            className="border-hair flex-1 rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          <button
            type="button"
            data-testid="onb-custom-save"
            onClick={commitCustom}
            disabled={customDraft.trim().length === 0}
            className="bg-accent rounded-xl px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {t('common:save')}
          </button>
          <button
            type="button"
            data-testid="onb-custom-cancel"
            onClick={() => {
              setCustomDraft('');
              setCustomMode('idle');
            }}
            className="border-hair text-ink-2 rounded-xl border bg-white px-3 py-2 text-xs"
          >
            {t('common:cancel')}
          </button>
        </div>
      )}

      <p className="text-ink-3 text-center text-[11px]">{t('onboarding:subtypes_min_hint')}</p>

      <button
        type="button"
        data-testid="continue"
        disabled={selected.length === 0}
        onClick={onContinue}
        className="bg-accent w-full rounded-xl py-3 font-medium text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_6px_20px_rgba(255,107,53,0.35)] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {t('common:continue')}
      </button>
    </section>
  );
}
