import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer, Check } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { ArticleQR } from '../components/article-qr';
import { useArticleDetail } from '../hooks/use-article-detail';
import { useProfile } from '../hooks/use-profile';
import { useQrBranding } from '../hooks/use-qr-branding';

export function ArticleLabelScreen(): JSX.Element | null {
  const { t } = useTranslation('label');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const detail = useArticleDetail(id);
  const profile = useProfile();

  // v0.6.5 — branding follows profile.qr_center_mode (logo / name).
  // The hook handles the auto-fallback when 'logo' is selected but
  // no logo is available, so this screen doesn't need to retry.
  const branding = useQrBranding();

  if (detail === undefined || profile === undefined) return null;
  const { article } = detail;
  if (!article) {
    return (
      <ScreenLayout hideNav>
        <div className="text-ink-3 p-6 text-center text-sm">{t('not_found')}</div>
      </ScreenLayout>
    );
  }

  function handlePrint(): void {
    window.print();
  }

  return (
    <ScreenLayout hideNav>
      <div
        data-testid="label-screen"
        className="flex flex-1 flex-col items-center justify-between gap-6 p-6 print:p-0"
      >
        {/* Printable label region. The print CSS in index.css promotes this
            to the only visible block on the page so the browser's print
            dialog produces a clean QR sheet without app chrome. */}
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
              articleId={article.id}
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
              {article.name}
            </p>
            <p
              data-testid="label-internal-code"
              className="text-ink-3 mt-1 font-mono text-sm tracking-wide"
              dir="ltr"
            >
              {article.internal_code}
            </p>
            {article.brand ? <p className="text-ink-3 mt-1 text-xs">{article.brand}</p> : null}
          </div>
        </section>

        {/* Action bar — hidden during print via print:hidden */}
        <div className="flex w-full max-w-sm flex-col gap-2 print:hidden">
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
            onClick={() => navigate(`/article/${article.id}`, { replace: true })}
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
