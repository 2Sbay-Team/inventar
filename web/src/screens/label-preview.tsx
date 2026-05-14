import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Check, Printer } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { ArticleQR } from '../components/article-qr';
import { useProfile } from '../hooks/use-profile';
import { useQrBranding } from '../hooks/use-qr-branding';

// v0.6 ADR-030 — Settings → "Preview label". Renders a stub label so
// the merchant can see how their printed labels look with the current
// logo / store name, without picking a real article. Identical layout
// to ArticleLabelScreen so the preview is faithful to what comes out
// of the printer.

const PREVIEW_ARTICLE_ID = 'SAMPLE-PREVIEW';

export function LabelPreviewScreen(): JSX.Element | null {
  const { t } = useTranslation('label');
  const navigate = useNavigate();
  const profile = useProfile();

  // v0.6.5 — driven by profile.qr_center_mode; see useQrBranding for
  // the auto-fallback behaviour when the merchant picked 'logo' but
  // their logo has since been removed.
  const branding = useQrBranding();

  function handlePrint(): void {
    window.print();
  }

  if (profile === undefined) return null;

  return (
    <ScreenLayout hideNav>
      <div
        data-testid="label-preview-screen"
        className="flex flex-1 flex-col items-center justify-between gap-6 p-6 print:p-0"
      >
        <section
          data-testid="label-print-region"
          className="border-hair flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border bg-white p-8 print:m-0 print:max-w-none print:rounded-none print:border-0 print:p-12"
        >
          {profile?.name ? (
            <p
              data-testid="label-shop-name"
              className="text-ink-3 text-center text-xs uppercase tracking-wide"
            >
              {profile.name}
            </p>
          ) : null}
          <div className="border-hair rounded-xl border bg-white p-2 print:border-0 print:p-0">
            <ArticleQR
              articleId={PREVIEW_ARTICLE_ID}
              size={256}
              testId="label-qr"
              branding={branding}
              brandColor={profile?.brand_primary_color}
            />
          </div>
          <div className="text-center">
            <p
              data-testid="label-article-name"
              className="text-ink font-display text-lg font-semibold leading-tight"
            >
              {t('preview_article_name')}
            </p>
            <p
              data-testid="label-internal-code"
              className="text-ink-3 mt-1 font-mono text-sm tracking-wide"
              dir="ltr"
            >
              FN-0042
            </p>
          </div>
        </section>

        <div className="flex w-full max-w-sm flex-col gap-2 print:hidden">
          <p className="text-ink-3 text-center text-xs">{t('preview_hint')}</p>
          <button
            type="button"
            data-testid="label-print"
            onClick={handlePrint}
            className="bg-accent inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white"
          >
            <Printer aria-hidden className="h-4 w-4" strokeWidth={2} />
            {t('print')}
          </button>
          <button
            type="button"
            data-testid="label-done"
            onClick={() => navigate('/settings', { replace: true })}
            className="border-hair text-ink inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium"
          >
            <Check aria-hidden className="h-4 w-4" strokeWidth={2} />
            {t('done')}
          </button>
        </div>
      </div>
    </ScreenLayout>
  );
}
