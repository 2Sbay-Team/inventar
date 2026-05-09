import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AppFooter } from '../components/app-footer';
import { db } from '../db/db';
import { DEFAULT_CURRENCY, upsertProfile } from '../repos/profile';
import { listSupportedCurrencies } from '../i18n/currency';
import { setLocale } from '../i18n/i18next';
import { useLocale } from '../hooks/use-locale';
import { ensurePersistence } from '../pwa/persistence';
import { type CurrencyCode, type Locale } from '../types';

const LANGUAGE_OPTIONS: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'en', label: 'English' },
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
        className="mx-auto flex w-full flex-1 flex-col items-stretch justify-center px-6 py-12 min-[600px]:max-w-[480px]"
      >
        {step === 'language' ? (
          <section data-testid="step-language" className="space-y-6">
            <h1 className="font-display text-3xl font-medium tracking-tight">
              {t('onboarding:pick_language')}
            </h1>
            <div className="space-y-3">
              {LANGUAGE_OPTIONS.map(({ code, label }) => (
                <button
                  key={code}
                  type="button"
                  data-testid={`lang-${code}`}
                  onClick={() => pickLanguage(code)}
                  className="border-hair w-full rounded-xl border bg-white p-4 text-start text-lg font-medium"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 'name' ? (
          <section data-testid="step-name" className="space-y-5">
            <label
              htmlFor="onb-shop-name"
              className="font-display block text-2xl font-medium tracking-tight"
            >
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
              className="border-hair w-full rounded-xl border bg-white px-4 py-3 text-base"
            />
            <p className="text-ink-3 text-xs">{t('onboarding:shop_name_min')}</p>

            <div>
              <label htmlFor="onb-currency" className="text-ink-2 mb-1 block text-sm font-medium">
                {t('settings:currency')}
              </label>
              <select
                id="onb-currency"
                data-testid="onb-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="border-hair w-full rounded-xl border bg-white px-4 py-3 text-base"
              >
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
              <p className="text-ink-3 mt-1 text-xs">{t('onboarding:pick_currency_hint')}</p>
            </div>

            <button
              type="button"
              data-testid="continue"
              disabled={shopName.trim().length < 2 || submitting}
              onClick={submitName}
              className="bg-ink w-full rounded-xl py-3 text-white disabled:opacity-50"
            >
              {t('common:continue')}
            </button>
          </section>
        ) : null}

        {step === 'backup_card' ? (
          <section data-testid="step-backup-card" className="space-y-5">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {t('onboarding:backup_card_title')}
            </h2>
            <p className="text-ink-2 text-sm leading-relaxed">{t('onboarding:backup_card_body')}</p>
            <button
              type="button"
              data-testid="got-it"
              disabled={submitting}
              onClick={() => void confirmBackupCard()}
              className="bg-ink w-full rounded-xl py-3 text-white disabled:opacity-50"
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
