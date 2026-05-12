import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AppThemePicker } from '../components/app-theme-picker';
import { BrandColorPicker } from '../components/brand-color-picker';
import { BusinessCard } from '../components/business-card';
import { CompletionRing } from '../components/completion-ring';
import { LogoPreviewDialog } from '../components/logo-preview-dialog';
import { OpeningHoursEditor } from '../components/opening-hours-editor';
import { computeCompletion } from '../theme/profile-completion';
import { PhotoThumb } from '../components/photo-thumb';
import { ScreenLayout } from '../components/screen-layout';
import { SelectWithCustom } from '../components/select-with-custom';
import { SettingsSection } from '../components/settings-section';
import { ShopHeader } from '../components/shop-header';
import { useSettingsSections, type SettingsSectionsApi } from '../hooks/use-settings-sections';
import { useAppUpdate } from '../hooks/use-app-update';
import { useInstallPrompt } from '../hooks/use-install-prompt';
import { useLocale } from '../hooks/use-locale';
import { useLocationLabels } from '../hooks/use-location-labels';
import {
  LOCATION_OPTIONS,
  normaliseBackLabel,
  normaliseFrontLabel,
} from '../config/location-options';
import { useProfile } from '../hooks/use-profile';
import { useLive } from '../hooks/use-live';
import { useAutosave, type AutosaveStatus } from '../hooks/use-autosave';
import {
  isLikelyEmail,
  normalizeFacebook,
  normalizePhone,
  normalizeSocialHandle,
  normalizeWebsite,
  trimToNullable,
  whatsappHref,
} from '../utils/field-format';
import {
  isAutoBackupSupported,
  pickAutoBackupFolder,
  setAutoBackupHandle,
} from '../utils/auto-backup';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';
import { db, resetDatabase } from '../db/db';
import { getProfile, upsertProfile } from '../repos/profile';
import { storePhoto } from '../repos/photos';
import { extractDominantColorFromBlob } from '../theme/extract-logo-color-from-blob';
import { downloadBackupFile } from '../backup/download';
import { APP_VERSION } from '../config/app-version';
import { importBackup, BackupIntegrityError, BackupParseError } from '../backup/import';
import { listSupportedCurrencies } from '../i18n/currency';
import { STORE_TYPES, STORE_TYPE_ORDER } from '../config/store-types';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../config/shop-subtypes';
import { FASHION_SUBTYPE_CONFIG, FASHION_SUBTYPE_ORDER } from '../config/fashion-subtypes';
import { ChevronRight, Download as DownloadIcon, Smartphone } from 'lucide-react';
import type { ShopProfile } from '../types';
import type { UpsertProfileInput } from '../repos/profile';
import {
  type CurrencyCode,
  type FashionSubtype,
  type Locale,
  type QrCenterMode,
  type ShopSubtype,
  type SizeStandard,
  type StoreType,
} from '../types';
import { ArticleQR } from '../components/article-qr';
import { useLogoDataUrl } from '../hooks/use-logo-data-url';
import { type QrBrandingOptions } from '../utils/qr-branding';

const EXPIRY_THRESHOLD_OPTIONS: readonly number[] = [3, 7, 14, 30];

// v0.5 ADR-018 (gap-fix opt-in): shop-only EAN strictness toggle.
// Default off — loose validation (12/13 digits, no checksum) covers
// the brief's test fixtures and most real Tunisian retail barcodes.
// On = strict EAN-13 checksum required (UPC-A is rejected too); the
// merchant flips this only if they're confident every item in their
// catalogue is a real EAN-13.
function EanStrictSection({
  profileLoaded,
  sections,
}: {
  profileLoaded: boolean;
  sections: SettingsSectionsApi;
}): JSX.Element | null {
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
    <SettingsSection
      id="ean-strict"
      title={t('ean_strict_title')}
      summary={stored ? t('ean_strict_label') : null}
      open={sections.isOpen('ean-strict')}
      onToggle={() => sections.toggle('ean-strict')}
    >
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
    </SettingsSection>
  );
}

// v0.5 ADR-019: shop-only Settings card. Reads/writes
// META_KEYS.expiry_threshold_days; default 7 if unset. The picker
// shows four chips. Saving writes immediately (no Save button) — the
// merchant's intent is unambiguous.
function ExpiryThresholdSection({
  profileLoaded,
  sections,
}: {
  profileLoaded: boolean;
  sections: SettingsSectionsApi;
}): JSX.Element | null {
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
    <SettingsSection
      id="expiry-threshold"
      title={t('expiry_threshold_title')}
      summary={t('expiry_threshold_unit', { n: value })}
      open={sections.isOpen('expiry-threshold')}
      onToggle={() => sections.toggle('expiry-threshold')}
    >
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
    </SettingsSection>
  );
}

// v0.6.5 — Settings → Shop profile → QR label branding picker.
// Two radio options + a small live preview that mirrors what the
// printed label will look like. The "logo" option hides when no
// logo is uploaded; the renderer auto-falls-back to 'name' via
// useQrBranding so the preview stays accurate even if the stored
// mode is still 'logo'. Both writes go through upsertProfile, which
// normalises ('logo', null-logo) → 'name' via deriveQrCenterMode so
// the DB never holds an unrenderable pair.
const QR_BRANDING_PREVIEW_ARTICLE_ID = 'SAMPLE-PREVIEW';
function QrBrandingPicker(): JSX.Element | null {
  const { t } = useTranslation('settings');
  const profile = useProfile();
  const logoDataUrl = useLogoDataUrl();
  if (!profile) return null;
  const hasLogo = !!profile.logo_photo_id;
  // What the picker shows as the active choice. The stored value can
  // be 'logo' on a row whose logo was just removed — render-side we
  // treat that as 'name' so the preview matches what'll actually
  // print. The next merchant write will normalise the row.
  const effectiveMode: QrCenterMode =
    profile.qr_center_mode === 'logo' && !hasLogo ? 'name' : profile.qr_center_mode;
  const previewBranding: QrBrandingOptions =
    effectiveMode === 'logo' && hasLogo && logoDataUrl
      ? { logoDataUrl, text: null }
      : { logoDataUrl: null, text: profile.name };

  async function setMode(mode: QrCenterMode): Promise<void> {
    if (!profile) return;
    if (mode === profile.qr_center_mode && effectiveMode === mode) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      qr_center_mode: mode,
    });
  }

  // v0.6.5 — Radix RadioGroup over a raw <input type="radio">. The
  // raw-input approach hit a controlled-radio-vs-async-side-effect
  // race in playwright: the browser flipped the radio's native
  // `checked` attribute on click, but React didn't re-render until
  // upsertProfile resolved, leaving the radio temporarily in a
  // DOM state that contradicted `effectiveMode`. RadioGroup is a
  // button-based primitive that drives `data-state` from `value` —
  // no native checked attribute, no race.
  return (
    <section
      data-testid="qr-branding"
      data-effective-mode={effectiveMode}
      data-stored-mode={profile.qr_center_mode}
      className="mt-5"
    >
      <h4 className="text-ink font-display text-sm font-medium">{t('qr_branding_title')}</h4>
      <p className="text-ink-3 mb-2 mt-1 text-xs leading-relaxed">{t('qr_branding_hint')}</p>
      <div className="flex items-start gap-3">
        <RadioGroup.Root
          value={effectiveMode}
          onValueChange={(v) => void setMode(v as QrCenterMode)}
          className="flex flex-1 flex-col gap-1.5"
        >
          {hasLogo ? (
            <label
              data-testid="qr-branding-row-logo"
              className="border-hair data-[checked=true]:border-accent flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"
              data-checked={effectiveMode === 'logo'}
            >
              <RadioGroup.Item
                value="logo"
                data-testid="qr-branding-radio-logo"
                className="border-hair data-[state=checked]:border-accent data-[state=checked]:bg-accent flex h-4 w-4 items-center justify-center rounded-full border bg-white"
                aria-label={t('qr_branding_logo')}
              >
                <RadioGroup.Indicator className="block h-1.5 w-1.5 rounded-full bg-white" />
              </RadioGroup.Item>
              {t('qr_branding_logo')}
            </label>
          ) : null}
          <label
            data-testid="qr-branding-row-name"
            className="border-hair data-[checked=true]:border-accent flex cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm"
            data-checked={effectiveMode === 'name'}
          >
            <RadioGroup.Item
              value="name"
              data-testid="qr-branding-radio-name"
              className="border-hair data-[state=checked]:border-accent data-[state=checked]:bg-accent flex h-4 w-4 items-center justify-center rounded-full border bg-white"
              aria-label={t('qr_branding_name')}
            >
              <RadioGroup.Indicator className="block h-1.5 w-1.5 rounded-full bg-white" />
            </RadioGroup.Item>
            {t('qr_branding_name')}
          </label>
        </RadioGroup.Root>
        <div
          data-testid="qr-branding-preview"
          className="border-hair flex h-[120px] w-[120px] flex-shrink-0 items-center justify-center rounded-xl border bg-white p-2"
          aria-label={t('qr_branding_preview_label')}
        >
          <ArticleQR
            articleId={QR_BRANDING_PREVIEW_ARTICLE_ID}
            size={104}
            testId="qr-branding-preview-qr"
            branding={previewBranding}
          />
        </div>
      </div>
    </section>
  );
}

// v0.5.2 ADR-022: stock-locations editor. Two-input form for the
// merchant-customisable display labels. Immediate save (matches the
// expiry-threshold + sub-types editor pattern). Clearing a field falls
// back to the (vertical, locale) default at next render via the hook
// — see useLocationLabels.
function StockLocationsSection({
  sections,
}: {
  sections: SettingsSectionsApi;
}): JSX.Element | null {
  const { t } = useTranslation('settings');
  const profile = useProfile();
  const labels = useLocationLabels();
  // v0.6.1 — dropdown options follow the runtime UI locale, not the
  // profile's frozen-at-onboarding locale. If the merchant onboarded
  // in EN and later switched to FR/AR, they should still see the
  // FR/AR option list here. Stored values stay verbatim (ADR-022).
  const { locale } = useLocale();
  if (!profile) return null;
  // v0.6 — the picker is the source of truth while open; commit
  // happens on every change (no separate draft + blur dance). Empty
  // values aren't reachable through SelectWithCustom (it reverts to
  // the first predefined option), but we still guard against them
  // before writing.
  //
  // v0.6.3 — SelectWithCustom's onChange hands us a DISPLAY string
  // (either a predefined option in the current locale, or a
  // merchant-typed custom value). normaliseFrontLabel converts that
  // to the canonical stored shape — a FrontKey for predefined
  // matches, or `custom:${raw}` for typed values. useLocationLabels
  // resolves keys back to localized displays at render time.
  async function commitFloor(value: string): Promise<void> {
    if (!profile) return;
    const normalised = normaliseFrontLabel(value);
    if (normalised === '') return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      location_floor_label: normalised,
    });
  }
  async function commitBack(value: string): Promise<void> {
    if (!profile) return;
    const normalised = normaliseBackLabel(value);
    if (normalised === '') return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      location_back_label: normalised,
    });
  }
  return (
    <SettingsSection
      id="stock-locations"
      title={t('locations_title')}
      summary={`${labels.floor} / ${labels.back}`}
      open={sections.isOpen('stock-locations')}
      onToggle={() => sections.toggle('stock-locations')}
    >
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
            options={LOCATION_OPTIONS[locale].floor}
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
            options={LOCATION_OPTIONS[locale].back}
            ariaLabel={t('location_back_label')}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

// v0.5.2.4 ADR-024 — invoicing / Facture fiscal block. Four optional
// fields that get baked into every issued invoice. All-or-nothing isn't
// enforced: a merchant who only fills in the legal name still gets a
// valid invoice (the missing fields just don't print). default_vat_pct
// is stored as integer percent for simplicity (no fractional VAT in any
// supported country yet); the per-invoice form lets the merchant
// override on a per-invoice basis.
// v0.9 ADR-039 / ADR-041 — Shop Identity section. Inline-edited
// text fields with debounced autosave. Phase 4a covers four
// subsections: Identity / Contact / Location / Social. Brand-colour
// picker, app-theme picker, completion ring, opening hours, and the
// digital business card land in later phases — this section gives
// them a home to slot into.
//
// Architecture:
//   * One autosave debouncer per section, shared by every field in
//     the section. The merchant typing across fields produces ONE
//     save 800ms after they stop. Each subsection has its own
//     debouncer so the "Saved ✓" indicator only lights up next to
//     the subsection the merchant actually edited.
//   * patchRef accumulates partial UpsertProfileInput between
//     fires so rapid cross-field edits don't lose values — the
//     debouncer's `onFlush` reads the full accumulator at fire time.
//   * Inputs hold draft string state locally; the autosave
//     pipeline writes through to the profile row. When the profile
//     row updates (live subscription via useProfile), the draft is
//     cleared so the rendered value re-reflects what's persisted.
function ShopIdentitySection({ sections }: { sections: SettingsSectionsApi }): JSX.Element | null {
  const { t } = useTranslation('settings');
  const profile = useProfile();
  if (!profile) return null;
  const completion = computeCompletion(profile);
  const nextHint =
    completion.next === null
      ? t('completion_hint_done')
      : t('completion_hint_next', {
          percent: completion.next.threshold,
          milestone: t(`completion_milestone_${completion.next.key}`),
        });
  // Collapsed summary: prefer the merchant's tagline (the headline
  // identity field); fall back to "Not configured yet" so the row
  // visually nudges them to expand. The completion ring still appears
  // in the body for the merchant who wants the full picture.
  const summary = profile.tagline ?? t('not_configured_yet');
  return (
    <SettingsSection
      id="shop-identity"
      title={t('identity_title')}
      summary={summary}
      open={sections.isOpen('shop-identity')}
      onToggle={() => sections.toggle('shop-identity')}
    >
      {/* v0.9 Phase 5 — body header carries the completion ring plus
          a one-line hint telling the merchant what to fill next. */}
      <div className="mb-4 flex items-start gap-3">
        <div className="flex-1">
          <p className="text-ink-3 text-xs leading-relaxed">{t('identity_hint')}</p>
          <p data-testid="completion-hint" className="text-ink-2 mt-2 text-[11px] leading-relaxed">
            {nextHint}
          </p>
        </div>
        <CompletionRing percentage={completion.percentage} />
      </div>
      <div className="space-y-5">
        <BrandColorSubsection profile={profile} />
        <AppThemeSubsection profile={profile} />
        <IdentitySubsection profile={profile} />
        <ContactSubsection profile={profile} />
        <LocationSubsection profile={profile} />
        <HoursSubsection profile={profile} />
        <SocialSubsection profile={profile} />
        <BusinessCardSubsection profile={profile} completionPercentage={completion.percentage} />
      </div>
    </SettingsSection>
  );
}

// Renders a small inline pill near a subsection header showing the
// autosave state. Idle = invisible (no chrome when nothing is
// happening); saving / saved / error get colour-coded styling.
function AutosaveBadge({ status }: { status: AutosaveStatus }): JSX.Element | null {
  const { t } = useTranslation('settings');
  if (status === 'idle') return null;
  const label =
    status === 'saving'
      ? t('identity_autosave_saving')
      : status === 'saved'
        ? t('identity_autosave_saved')
        : t('identity_autosave_error');
  const tone = status === 'saving' ? 'text-ink-3' : status === 'saved' ? 'text-ok' : 'text-bad';
  return (
    <span data-testid={`autosave-${status}`} className={`text-[11px] ${tone}`}>
      {label}
    </span>
  );
}

// Shared autosave wiring for one subsection. Returns the dispatcher
// each field uses (`setField(key, value)`) plus the current status.
// The patch accumulator is held in a ref so rapid cross-field edits
// inside the 800ms window all batch into a single upsertProfile call.
//
// `flush` lets discrete actions (a swatch tap, a checkbox toggle)
// commit immediately instead of waiting on the 800ms debounce. The
// brief's "no perceived lag on a tap" UX demands that pickers don't
// share the text-typing latency; flush() bypasses the wait while
// keeping the same single-source-of-truth save path.
function useSubsectionAutosave(profile: ShopProfile): {
  setField: <K extends keyof UpsertProfileInput>(key: K, value: UpsertProfileInput[K]) => void;
  flush: () => void;
  status: AutosaveStatus;
} {
  const patchRef = useRef<Partial<UpsertProfileInput>>({});
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const autosave = useAutosave<void>(async () => {
    const cur = profileRef.current;
    const patch = patchRef.current;
    patchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    await upsertProfile(db, {
      name: cur.name,
      locale: cur.locale,
      ...patch,
    });
  });
  const setField = useCallback(
    <K extends keyof UpsertProfileInput>(key: K, value: UpsertProfileInput[K]) => {
      patchRef.current = { ...patchRef.current, [key]: value };
      autosave.trigger();
    },
    [autosave],
  );
  return { setField, flush: autosave.flush, status: autosave.status };
}

// v0.9 Phase 6 — Digital business card. The brief gates this
// subsection at "≥ 30% complete" — below that we render a teaser
// pointing the merchant at what to fill. The completion threshold
// is purely about motivating the merchant to fill more fields; the
// card would render fine at 0% but with very little to show.
function BusinessCardSubsection({
  profile,
  completionPercentage,
}: {
  profile: ShopProfile;
  completionPercentage: number;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const unlocked = completionPercentage >= 30;
  return (
    <div className="space-y-3" data-testid="section-business-card">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('card_title')}</h4>
      </div>
      {unlocked ? (
        <>
          <p className="text-ink-3 text-[11px] leading-relaxed">{t('card_hint')}</p>
          <BusinessCard profile={profile} />
        </>
      ) : (
        <p
          data-testid="business-card-teaser"
          className="border-hair text-ink-3 rounded-xl border border-dashed bg-white px-3 py-4 text-xs leading-relaxed"
        >
          {t('card_teaser')}
        </p>
      )}
    </div>
  );
}

function BrandColorSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, flush, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('brand_color_title')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <p className="text-ink-3 text-[11px] leading-relaxed">{t('brand_color_hint')}</p>
      <BrandColorPicker
        brandPrimaryColor={profile.brand_primary_color}
        logoDominantColor={profile.logo_dominant_color}
        onChange={(hex) => {
          setField('brand_primary_color', hex);
          // Discrete tap — flush so the app re-paints on the next
          // frame, not 800ms later.
          flush();
        }}
      />
    </div>
  );
}

function AppThemeSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, flush, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('theme_title')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <p className="text-ink-3 text-[11px] leading-relaxed">{t('theme_hint')}</p>
      <AppThemePicker
        themeBgColor={profile.theme_bg_color}
        brandPrimaryColor={profile.brand_primary_color}
        onChange={(hex) => {
          setField('theme_bg_color', hex);
          flush();
        }}
      />
    </div>
  );
}

function IdentitySubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('identity_section_identity')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <IdentityTextField
        testId="identity-tagline"
        label={t('identity_tagline')}
        placeholder={t('identity_tagline_placeholder')}
        hint={t('identity_tagline_hint')}
        initial={profile.tagline}
        maxLength={80}
        onCommit={(value) => setField('tagline', value)}
      />
      <IdentityTextField
        testId="identity-description"
        label={t('identity_description')}
        placeholder={t('identity_description_placeholder')}
        hint={t('identity_description_hint')}
        initial={profile.description}
        maxLength={300}
        multiline
        onCommit={(value) => setField('description', value)}
      />
      {/* Legal business name + Tax / fiscal ID surfaced here in addition
          to the Invoicing section. Both write to the same
          profile.legal_name / profile.fiscal_id columns — Invoicing
          stays the canonical surface for "this is on every invoice"
          and the merchant can edit either spot. */}
      <IdentityTextField
        testId="identity-legal-name"
        label={t('identity_legal_name')}
        placeholder={t('identity_legal_name_placeholder')}
        hint={t('identity_legal_name_hint')}
        initial={profile.legal_name}
        maxLength={120}
        onCommit={(value) => setField('legal_name', value)}
      />
      <IdentityTextField
        testId="identity-fiscal-id"
        label={t('identity_fiscal_id')}
        placeholder={t('identity_fiscal_id_placeholder')}
        hint={t('identity_fiscal_id_hint')}
        initial={profile.fiscal_id}
        maxLength={60}
        onCommit={(value) => setField('fiscal_id', value)}
      />
    </div>
  );
}

function ContactSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, status } = useSubsectionAutosave(profile);
  const waHref = whatsappHref(profile.whatsapp);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('identity_section_contact')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <IdentityTextField
        testId="identity-whatsapp"
        label={t('identity_whatsapp')}
        placeholder={t('identity_whatsapp_placeholder')}
        initial={profile.whatsapp}
        onCommit={(value) => setField('whatsapp', normalizePhone(value ?? ''))}
        suffix={
          waHref ? (
            <a
              data-testid="identity-whatsapp-test"
              href={waHref}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent text-xs"
            >
              {t('identity_whatsapp_test')}
            </a>
          ) : null
        }
      />
      <IdentityEmailField
        testId="identity-email"
        label={t('identity_email')}
        placeholder={t('identity_email_placeholder')}
        initial={profile.email}
        invalidMessage={t('identity_email_invalid')}
        onCommit={(value) => setField('email', value)}
      />
      <IdentityTextField
        testId="identity-website"
        label={t('identity_website')}
        placeholder={t('identity_website_placeholder')}
        initial={profile.website}
        onCommit={(value) => setField('website', normalizeWebsite(value ?? ''))}
      />
    </div>
  );
}

function LocationSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('identity_section_location')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <IdentityTextField
        testId="identity-address-street"
        label={t('identity_address_street')}
        placeholder={t('identity_address_street_placeholder')}
        initial={profile.address_street}
        onCommit={(value) => setField('address_street', value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <IdentityTextField
          testId="identity-address-city"
          label={t('identity_address_city')}
          placeholder={t('identity_address_city_placeholder')}
          initial={profile.address_city}
          onCommit={(value) => setField('address_city', value)}
        />
        <IdentityTextField
          testId="identity-address-country"
          label={t('identity_address_country')}
          placeholder={t('identity_address_country_placeholder')}
          initial={profile.address_country}
          onCommit={(value) => setField('address_country', value)}
        />
      </div>
    </div>
  );
}

function HoursSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('opening_hours_title')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <p className="text-ink-3 text-[11px] leading-relaxed">{t('opening_hours_hint')}</p>
      <OpeningHoursEditor
        value={profile.opening_hours}
        onChange={(next) => setField('opening_hours', next)}
      />
    </div>
  );
}

function SocialSubsection({ profile }: { profile: ShopProfile }): JSX.Element {
  const { t } = useTranslation('settings');
  const { setField, status } = useSubsectionAutosave(profile);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-display text-sm font-medium">{t('identity_section_social')}</h4>
        <AutosaveBadge status={status} />
      </div>
      <IdentityTextField
        testId="identity-instagram"
        label={t('identity_instagram')}
        placeholder={t('identity_instagram_placeholder')}
        initial={profile.instagram}
        onCommit={(value) => setField('instagram', normalizeSocialHandle(value ?? ''))}
      />
      <IdentityTextField
        testId="identity-facebook"
        label={t('identity_facebook')}
        placeholder={t('identity_facebook_placeholder')}
        initial={profile.facebook}
        onCommit={(value) => setField('facebook', normalizeFacebook(value ?? ''))}
      />
      <IdentityTextField
        testId="identity-tiktok"
        label={t('identity_tiktok')}
        placeholder={t('identity_tiktok_placeholder')}
        initial={profile.tiktok}
        onCommit={(value) => setField('tiktok', normalizeSocialHandle(value ?? ''))}
      />
    </div>
  );
}

// Generic text field used across every Shop Identity subsection.
// `initial` is the persisted value; the input renders local draft
// state until the merchant commits. `onCommit` fires on every
// keystroke — the debouncer in the parent coalesces them.
//
// Draft lifecycle: the local draft sits "above" the prop until the
// autosave round-trip completes and the prop reflects the committed
// value. The useEffect below clears the draft once that happens —
// NOT on blur, because clearing on blur reverts the input to the
// stale prop for the 800ms before autosave flushes (the typed text
// visibly disappears, then reappears once the save lands).
function IdentityTextField(props: {
  testId: string;
  label: string;
  placeholder?: string;
  hint?: string;
  initial: string | null;
  maxLength?: number;
  multiline?: boolean;
  onCommit: (value: string | null) => void;
  suffix?: React.ReactNode;
}): JSX.Element {
  const { t } = useTranslation('settings');
  const { testId, label, placeholder, hint, initial, maxLength, multiline, onCommit, suffix } =
    props;
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? initial ?? '';
  // Sync down: once the persisted prop matches whatever we've drafted
  // (i.e. the autosave has flushed and the profile re-rendered), drop
  // the local copy so subsequent prop updates from elsewhere (e.g.
  // a backup import) show through immediately.
  useEffect(() => {
    setDraft(null);
  }, [initial]);
  function handleChange(value: string): void {
    setDraft(value);
    onCommit(trimToNullable(value));
  }
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={testId} className="text-ink-2 text-xs font-medium">
          {label}
        </label>
        {suffix ? <div>{suffix}</div> : null}
      </div>
      <Tag
        id={testId}
        data-testid={testId}
        type={multiline ? undefined : 'text'}
        value={displayValue}
        placeholder={placeholder}
        maxLength={maxLength}
        rows={multiline ? 3 : undefined}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          handleChange(e.target.value)
        }
        className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
      />
      {(hint || maxLength) && (
        <div className="flex items-baseline justify-between gap-2">
          {hint ? <p className="text-ink-3 text-[11px] leading-relaxed">{hint}</p> : <span />}
          {maxLength ? (
            <span
              data-testid={`${testId}-counter`}
              className="text-ink-3 shrink-0 text-[11px] tabular-nums"
            >
              {t('identity_char_counter', { count: displayValue.length, max: maxLength })}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

// Email-shaped variant of IdentityTextField. Renders an inline
// "doesn't look like an email" hint when the draft fails the lite
// RFC check — purely informational, the save still goes through.
// Empty input never lights the warning.
function IdentityEmailField(props: {
  testId: string;
  label: string;
  placeholder?: string;
  initial: string | null;
  invalidMessage: string;
  onCommit: (value: string | null) => void;
}): JSX.Element {
  const { testId, label, placeholder, initial, invalidMessage, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? initial ?? '';
  const looksLikeEmail = isLikelyEmail(displayValue);
  // Same sync-down rule as IdentityTextField — clearing on blur was
  // visibly reverting the typed text for 800ms until autosave landed.
  useEffect(() => {
    setDraft(null);
  }, [initial]);
  return (
    <div className="space-y-1">
      <label htmlFor={testId} className="text-ink-2 block text-xs font-medium">
        {label}
      </label>
      <input
        id={testId}
        data-testid={testId}
        type="email"
        value={displayValue}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(trimToNullable(e.target.value));
        }}
        className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
      />
      {!looksLikeEmail && displayValue.trim() !== '' ? (
        <p data-testid={`${testId}-invalid`} className="text-bad text-[11px]">
          {invalidMessage}
        </p>
      ) : null}
    </div>
  );
}

function InvoicingSection({ sections }: { sections: SettingsSectionsApi }): JSX.Element | null {
  const { t } = useTranslation('settings');
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
  const summary =
    profile.default_vat_pct != null
      ? t('invoicing_summary_configured', { pct: profile.default_vat_pct })
      : t('not_configured_yet');
  return (
    <SettingsSection
      id="invoicing"
      title={t('invoicing_title')}
      summary={summary}
      open={sections.isOpen('invoicing')}
      onToggle={() => sections.toggle('invoicing')}
    >
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
      </div>
    </SettingsSection>
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
// v0.6.3 — "About" + manual update check. Placed above
// MaintenanceSection so a merchant who hits the consent gate's
// Skip/Snooze still has a way to re-trigger the update prompt
// later. forcePrompt bypasses snooze/skip — the merchant's tap
// here is the explicit consent.
function AboutSection({ sections }: { sections: SettingsSectionsApi }): JSX.Element {
  const { t } = useTranslation('settings');
  const update = useAppUpdate();
  const [checking, setChecking] = useState(false);
  const [toast, setToast] = useState<'latest' | 'offline' | null>(null);

  // Auto-clear the toast after a few seconds so a merchant who taps
  // again later doesn't see stale copy.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function handleCheck(): Promise<void> {
    setChecking(true);
    setToast(null);
    try {
      const result = await update.checkForUpdates();
      if (result.found) return; // modal opens; no toast.
      setToast(result.online ? 'latest' : 'offline');
    } finally {
      setChecking(false);
    }
  }

  const version = APP_VERSION.trim() !== '' ? `v${APP_VERSION}` : t('about_version_unknown');

  return (
    <SettingsSection
      id="about"
      title={t('about_title')}
      summary={version}
      open={sections.isOpen('about')}
      onToggle={() => sections.toggle('about')}
    >
      <p data-testid="about-version" className="text-ink-3 mb-3 text-xs">
        {t('about_version_label')}: <span className="font-mono">{version}</span>
      </p>
      <button
        type="button"
        data-testid="about-check-updates"
        onClick={() => void handleCheck()}
        disabled={checking}
        className="border-hair w-full rounded-xl border bg-white py-2.5 text-sm disabled:opacity-50"
      >
        {checking ? t('checking_for_updates') : t('check_for_updates')}
      </button>
      {toast === 'latest' ? (
        <p
          data-testid="about-toast-latest"
          role="status"
          className="text-ok bg-ok-soft border-hair mt-3 rounded-xl border px-3 py-2 text-xs"
        >
          {t('update_check_latest')}
        </p>
      ) : null}
      {toast === 'offline' ? (
        <p
          data-testid="about-toast-offline"
          role="status"
          className="text-bad bg-bad-soft border-hair mt-3 rounded-xl border px-3 py-2 text-xs"
        >
          {t('update_check_offline')}
        </p>
      ) : null}
    </SettingsSection>
  );
}

function MaintenanceSection({ sections }: { sections: SettingsSectionsApi }): JSX.Element {
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
    <SettingsSection
      id="maintenance"
      title={t('maintenance_title')}
      open={sections.isOpen('maintenance')}
      onToggle={() => sections.toggle('maintenance')}
    >
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
    </SettingsSection>
  );
}

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
  const { t: tLogo } = useTranslation('logo');
  const { locale, setLocale } = useLocale();
  const profile = useProfile();
  const sections = useSettingsSections();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const [shopNameDraft, setShopNameDraft] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  // v0.5.4 ADR-028 — keying preview state; see onboarding for parallel.
  const [logoKeyingCandidate, setLogoKeyingCandidate] = useState<{
    originalBlob: Blob;
    keyedBlob: Blob;
    width: number;
    height: number;
  } | null>(null);
  const [logoToast, setLogoToast] = useState<string | null>(null);
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
    // v0.6.2 — delegate to the shared helper so the v0.6.2 update
    // modal and Settings → Export Data take the exact same code path.
    await downloadBackupFile({ appVersion: APP_VERSION });
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
    setLogoToast(null);
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
      // v0.5.4 ADR-028 — keying attempt. On 'keyed' we open the
      // preview Dialog and defer the storePhoto + upsertProfile to
      // the merchant's choice. On 'skipped' / 'rejected' (non-fatal)
      // we proceed straight to store the original compressed blob.
      const { analyseLogoForKeying } = await import('../utils/logo-transparency');
      const outcome = await analyseLogoForKeying({
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      if (outcome.kind === 'keyed') {
        setLogoKeyingCandidate({
          originalBlob: compressed.blob,
          keyedBlob: outcome.keyedBlob,
          width: compressed.width,
          height: compressed.height,
        });
        return;
      }
      if (outcome.kind === 'rejected') {
        if (outcome.reason === 'all-transparent') {
          setLogoError(tLogo('too_much_background'));
          return;
        }
        setLogoToast(tLogo('removal_failed_toast'));
      }
      const stored = await storePhoto(db, {
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      // v0.9 ADR-042 — sample the dominant brand colour off the
      // compressed blob (pre-keying, since this branch took the
      // "skipped" path or surfaced a toast). Null when no usable
      // colour was found.
      const dominantColor = await extractDominantColorFromBlob(compressed.blob);
      await upsertProfile(db, {
        name: profile.name,
        locale: profile.locale,
        logo_photo_id: stored.id,
        logo_dominant_color: dominantColor,
      });
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  // v0.5.4 — commit the merchant's pick from LogoPreviewDialog. Mime
  // matches the chosen branch (image/png for keyed, image/jpeg for
  // original) so the Photo row carries the right type for downstream
  // renderers (invoice PDF in particular).
  async function commitLogoChoice(choice: {
    blob: Blob;
    kind: 'transparent' | 'original';
  }): Promise<void> {
    if (!profile || !logoKeyingCandidate) return;
    const mime = choice.kind === 'transparent' ? 'image/png' : 'image/jpeg';
    setLogoBusy(true);
    try {
      const stored = await storePhoto(db, {
        blob: choice.blob,
        width: logoKeyingCandidate.width,
        height: logoKeyingCandidate.height,
        mime,
      });
      // v0.9 ADR-042 — extract from the merchant's committed choice.
      // 'transparent' branch reads the keyed PNG (background already
      // alpha=0, so the saturation filter sees pure logo pixels);
      // 'original' reads the unkeyed JPEG and lets the luminance
      // gate drop the background.
      const dominantColor = await extractDominantColorFromBlob(choice.blob);
      await upsertProfile(db, {
        name: profile.name,
        locale: profile.locale,
        logo_photo_id: stored.id,
        logo_dominant_color: dominantColor,
      });
    } finally {
      setLogoBusy(false);
      setLogoKeyingCandidate(null);
    }
  }

  async function removeLogo(): Promise<void> {
    if (!profile) return;
    setLogoBusy(true);
    try {
      // v0.9 ADR-042 — clear the cached dominant colour too. The
      // merchant's brand_primary_color is intentionally NOT touched
      // here: removing the logo doesn't undo a brand choice they
      // already applied to the app. Only the per-logo cache resets.
      await upsertProfile(db, {
        name: profile.name,
        locale: profile.locale,
        logo_photo_id: null,
        logo_dominant_color: null,
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

  async function selectSizeStandard(std: SizeStandard): Promise<void> {
    if (!profile || profile.size_standard === std) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      size_standard: std,
    });
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

  // One-line summaries shown on the collapsed accordion headers.
  // Computed inline (memoised at render — none of these are expensive)
  // so the strings stay close to the data they describe and we don't
  // need a separate file for what's effectively view-logic.
  // Summaries for sections owned directly by SettingsScreen (the
  // sub-components compute their own). identity / invoicing / about /
  // expiry-threshold all live in dedicated sub-components and read
  // their data there.
  const langSummary = LANGUAGES.find((l) => l.code === locale)?.label ?? locale;
  const shopProfileSummary = profile
    ? `${profile.name} · ${tStoreTypes(STORE_TYPES[profile.store_type].label_key)}`
    : '';
  const fashionSubtypesSummary = t('selected_count', {
    n: profile?.fashion_subtypes.length ?? 0,
  });
  const shopSubtypesSummary = t('selected_count', { n: profile?.shop_subtypes.length ?? 0 });
  const backupSummary = profile?.last_backup_at
    ? `${t('backup_last')}: ${profile.last_backup_at}`
    : `${t('backup_last')}: ${t('backup_never')}`;

  return (
    <ScreenLayout>
      <ShopHeader />
      <main
        data-testid="settings-screen"
        className="flex flex-1 flex-col gap-4 px-5 py-4 overflow-y-auto"
      >
        <SettingsSection
          id="language"
          title={t('language')}
          summary={langSummary}
          open={sections.isOpen('language')}
          onToggle={() => sections.toggle('language')}
        >
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
        </SettingsSection>

        <SettingsSection
          id="shop-profile"
          title={t('shop_profile')}
          summary={shopProfileSummary}
          open={sections.isOpen('shop-profile')}
          onToggle={() => sections.toggle('shop-profile')}
        >
          <div className="flex items-center gap-3">
            <PhotoThumb
              photoId={profile?.logo_photo_id ?? null}
              size={56}
              testId="shop-logo-preview"
              className="rounded-full"
              // v0.6.2 — drop the cream backdrop only when there IS
              // a logo; otherwise keep the placeholder backdrop so
              // the empty-state ImageIcon stays visible against the
              // white Settings card.
              transparent={!!profile?.logo_photo_id}
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
          {logoToast ? (
            <p
              data-testid="shop-logo-toast"
              role="status"
              className="text-ink-3 bg-paper-deep border-hair mt-2 rounded-xl border px-3 py-2 text-xs"
            >
              {logoToast}
            </p>
          ) : null}
          {logoKeyingCandidate ? (
            <LogoPreviewDialog
              open
              originalBlob={logoKeyingCandidate.originalBlob}
              keyedBlob={logoKeyingCandidate.keyedBlob}
              onChoose={(c) => void commitLogoChoice(c)}
              onCancel={() => setLogoKeyingCandidate(null)}
            />
          ) : null}

          <QrBrandingPicker />

          <Link
            to="/settings/label-preview"
            data-testid="settings-label-preview"
            className="border-hair text-ink mt-3 inline-flex w-full items-center justify-center rounded-xl border bg-white py-2 text-sm"
          >
            {t('preview_label')}
          </Link>

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

          <fieldset className="mt-4">
            <legend className="text-ink-3 mb-1 block text-xs">{t('size_standard')}</legend>
            <div data-testid="settings-size-standard" className="grid grid-cols-2 gap-2">
              {(['EU', 'US', 'UK', 'JP'] as const).map((std) => {
                const active = (profile?.size_standard ?? 'EU') === std;
                return (
                  <button
                    key={std}
                    type="button"
                    data-testid={`settings-size-standard-${std}`}
                    aria-pressed={active}
                    onClick={() => void selectSizeStandard(std)}
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      active
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-hair bg-white'
                    }`}
                  >
                    {t(`size_standard_${std}`)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </SettingsSection>

        {/* v0.9 Phase 4a — Shop Identity section. Sits just below
            the legacy shop-profile section (logo + name + currency)
            so the new identity fields appear next to the old ones
            without disrupting the existing layout. Brand picker,
            theme picker, completion ring, and opening hours all
            land inside this section in later phases. */}
        <ShopIdentitySection sections={sections} />

        {profile?.store_type === 'shop' ? (
          <SettingsSection
            id="shop-subtypes"
            title={t('shop_subtypes_title')}
            summary={shopSubtypesSummary}
            open={sections.isOpen('shop-subtypes')}
            onToggle={() => sections.toggle('shop-subtypes')}
          >
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
          </SettingsSection>
        ) : null}

        {profile?.store_type === 'fashion' ? (
          <SettingsSection
            id="fashion-subtypes"
            title={t('fashion_subtypes_title')}
            summary={fashionSubtypesSummary}
            open={sections.isOpen('fashion-subtypes')}
            onToggle={() => sections.toggle('fashion-subtypes')}
          >
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
          </SettingsSection>
        ) : null}

        {profile?.store_type === 'shop' ? (
          <ExpiryThresholdSection profileLoaded={Boolean(profile)} sections={sections} />
        ) : null}

        {profile?.store_type === 'shop' ? (
          <EanStrictSection profileLoaded={Boolean(profile)} sections={sections} />
        ) : null}

        {/* v0.5.2.7: surfaced Invoicing higher in the list — merchants
            reported they couldn't find legal name / address / fiscal ID
            / VAT when these lived at the bottom of Settings.
            v0.9: the "View past invoices" link moved out — Past Invoices
            belongs on the Sale tab → Documents sub-tab, not Settings.
            The /invoices route still resolves direct links. */}
        <InvoicingSection sections={sections} />

        <SettingsSection
          id="install"
          title={t('install_section')}
          open={sections.isOpen('install')}
          onToggle={() => sections.toggle('install')}
        >
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
        </SettingsSection>

        <SettingsSection
          id="backup"
          title={t('backup_section')}
          summary={backupSummary}
          open={sections.isOpen('backup')}
          onToggle={() => sections.toggle('backup')}
        >
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
        </SettingsSection>

        {/* Help and Archive are nav rows, not collapsible — they jump
            to their own screens. Match the 56px footprint + chevron
            of accordion headers so the column reads as one column. */}
        <Link
          to="/help"
          data-testid="help-link"
          className="border-hair flex h-14 items-center justify-between rounded-2xl border bg-white px-4"
        >
          <span className="font-display text-sm font-semibold text-ink">{t('help')}</span>
          <ChevronRight
            aria-hidden
            className="text-ink-3 h-5 w-5 rtl:-scale-x-100"
            strokeWidth={2}
          />
        </Link>

        <Link
          to="/settings/archive"
          data-testid="archive-bin-link"
          className="border-hair flex h-14 items-center justify-between rounded-2xl border bg-white px-4"
        >
          <span className="font-display text-sm font-semibold text-ink">{t('archive_bin')}</span>
          <ChevronRight
            aria-hidden
            className="text-ink-3 h-5 w-5 rtl:-scale-x-100"
            strokeWidth={2}
          />
        </Link>

        <StockLocationsSection sections={sections} />

        <AboutSection sections={sections} />

        <MaintenanceSection sections={sections} />

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
