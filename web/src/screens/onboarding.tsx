import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Boxes, Check } from 'lucide-react';
import { AppFooter } from '../components/app-footer';
import { db } from '../db/db';
import { DEFAULT_CURRENCY, upsertProfile } from '../repos/profile';
import { listSupportedCurrencies } from '../i18n/currency';
import { setLocale } from '../i18n/i18next';
import { useLocale } from '../hooks/use-locale';
import { ensurePersistence } from '../pwa/persistence';
import { type CurrencyCode, type Locale } from '../types';

interface LanguageOption {
  code: Locale;
  label: string;
  // English name shown as a small subtitle so a user who doesn't read the
  // native script can still recognise their language.
  subtitle: string;
  flag: string;
}

const LANGUAGE_OPTIONS: ReadonlyArray<LanguageOption> = [
  { code: 'fr', label: 'Français', subtitle: 'French', flag: '🇫🇷' },
  { code: 'ar', label: 'العربية', subtitle: 'Arabic', flag: '🇹🇳' },
  { code: 'en', label: 'English', subtitle: 'English', flag: '🇬🇧' },
];

// SPEC §2.1 onboarding: language → shop name → "got it" backup card → land
// on the empty Search screen. Single screen with stepwise reveal. No network.
export function OnboardingScreen(): JSX.Element {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const navigate = useNavigate();

  const [step, setStep] = useState<'language' | 'name' | 'backup_card'>('language');
  const [shopName, setShopName] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [submitting, setSubmitting] = useState(false);
  const currencies = listSupportedCurrencies();

  function pickLanguage(code: Locale): void {
    void setLocale(code);
    setStep('name');
  }

  function submitName(): void {
    // Don't write the profile yet — once it exists, the OnboardingOnly gate
    // would yank the user off onto Search before they see the backup card.
    // Profile + persistence land on `confirmBackupCard` instead.
    if (shopName.trim().length < 2) return;
    setStep('backup_card');
  }

  async function confirmBackupCard(): Promise<void> {
    setSubmitting(true);
    await upsertProfile(db, { name: shopName.trim(), locale, currency });
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
              {LANGUAGE_OPTIONS.map(({ code, label, subtitle, flag }) => (
                <button
                  key={code}
                  type="button"
                  data-testid={`lang-${code}`}
                  onClick={() => pickLanguage(code)}
                  className="border-hair hover:border-accent hover:bg-accent-soft/40 group flex w-full items-center gap-4 rounded-2xl border bg-white p-4 text-start transition-colors"
                >
                  <span aria-hidden className="text-2xl leading-none">
                    {flag}
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-ink text-lg font-medium leading-tight">{label}</span>
                    <span className="text-ink-3 text-xs">{subtitle}</span>
                  </span>
                  <Check
                    aria-hidden
                    className="text-accent h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100"
                    strokeWidth={2.5}
                  />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 'name' ? (
          <section data-testid="step-name" className="space-y-6">
            <div className="text-center">
              <h1 className="font-display text-ink text-3xl font-semibold tracking-tight">
                {t('onboarding:setup_title')}
              </h1>
              <p className="text-ink-2 mt-3 text-[15px] leading-relaxed">
                {t('onboarding:setup_subtitle')}
              </p>
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
              className="bg-accent w-full rounded-xl py-3 font-medium text-white disabled:opacity-50"
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
              className="bg-accent w-full rounded-xl py-3 font-medium text-white disabled:opacity-50"
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
