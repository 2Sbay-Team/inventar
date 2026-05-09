import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { PhotoThumb } from '../components/photo-thumb';
import { STORE_TYPES } from '../config/store-types';
import { db } from '../db/db';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { quantityFor } from '../repos/quantity';
import { type Article, type Variant } from '../types';

interface VariantRow {
  size: string | null;
  qty: number;
}

interface StockRow {
  article: Article;
  variants: VariantRow[];
  totalUnits: number;
  totalValueAtCost: number;
}

interface StockReport {
  shopName: string;
  generatedAt: string;
  rows: StockRow[];
  totalArticles: number;
  totalUnits: number;
  totalValueAtCost: number;
}

const EMPTY_REPORT: StockReport = {
  shopName: '',
  generatedAt: new Date().toISOString(),
  rows: [],
  totalArticles: 0,
  totalUnits: 0,
  totalValueAtCost: 0,
};

// Builds the full per-article + per-size breakdown for the printable
// report. We accept the in-memory cost of walking every variant and
// every movement because the report's job IS to be exhaustive — the
// shopkeeper prints this and walks the shop ticking items off.
async function computeReport(): Promise<StockReport> {
  const [profile, articles, variants] = await Promise.all([
    db.profile.get('singleton'),
    db.articles.toArray(),
    db.variants.toArray(),
  ]);

  const aliveArticles = articles
    .filter((a) => a.deleted_at === null && a.archived_at === null)
    // Stable sort: category, then internal_code so the printout is
    // predictable across runs (same shop, same order on the page).
    .sort((a, b) => {
      const catCmp = a.category.localeCompare(b.category);
      if (catCmp !== 0) return catCmp;
      return a.internal_code.localeCompare(b.internal_code, undefined, { numeric: true });
    });

  const variantsByArticle = new Map<string, Variant[]>();
  for (const v of variants) {
    if (v.deleted_at !== null) continue;
    const list = variantsByArticle.get(v.article_id) ?? [];
    list.push(v);
    variantsByArticle.set(v.article_id, list);
  }

  const rows: StockRow[] = [];
  let totalUnits = 0;
  let totalValueAtCost = 0;
  for (const article of aliveArticles) {
    const vlist = (variantsByArticle.get(article.id) ?? [])
      .slice()
      .sort((a, b) => (a.size ?? '').localeCompare(b.size ?? '', undefined, { numeric: true }));
    const variantRows: VariantRow[] = [];
    let articleTotal = 0;
    for (const v of vlist) {
      const qty = await quantityFor(db, v.id);
      variantRows.push({ size: v.size, qty });
      articleTotal += qty;
    }
    totalUnits += articleTotal;
    totalValueAtCost += articleTotal * article.cost_price_tnd;
    rows.push({
      article,
      variants: variantRows,
      totalUnits: articleTotal,
      totalValueAtCost: articleTotal * article.cost_price_tnd,
    });
  }

  return {
    shopName: profile?.name ?? '',
    generatedAt: new Date().toISOString(),
    rows,
    totalArticles: aliveArticles.length,
    totalUnits,
    totalValueAtCost,
  };
}

export function StockReportScreen(): JSX.Element {
  const { t } = useTranslation('stock_report');
  const { t: tCommon } = useTranslation('common');
  const { t: tCategory } = useTranslation('category');
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const sized = STORE_TYPES[profile?.store_type ?? 'shoes'].has_sizes;
  const report = useLive<StockReport>(computeReport, [], EMPTY_REPORT) ?? EMPTY_REPORT;
  const navigate = useNavigate();

  const dateLabel = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'fr-TN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(report.generatedAt));

  return (
    <ScreenLayout hideNav>
      <header className="border-hair flex flex-shrink-0 items-center gap-3 border-b bg-white px-4 py-3 print:hidden">
        <button
          type="button"
          data-testid="report-back"
          onClick={() => navigate(-1)}
          className="text-ink-2 hover:text-ink p-1"
          aria-label={tCommon('back')}
        >
          <ArrowLeft aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
        <h1 className="font-display text-ink flex-1 text-base font-semibold">{t('title')}</h1>
        <button
          type="button"
          data-testid="report-print"
          onClick={() => window.print()}
          className="bg-accent inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
        >
          <Printer aria-hidden className="h-4 w-4" strokeWidth={2.25} />
          {t('print_button')}
        </button>
      </header>

      <main
        data-testid="stock-report"
        className="bg-paper flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 print:overflow-visible print:px-0 print:py-0"
      >
        {/* Print-only header so the printed page identifies itself. */}
        <header className="hidden print:block print:mb-4">
          <h1 className="font-display text-2xl font-bold">{report.shopName}</h1>
          <p className="text-sm">{t('print_subtitle', { date: dateLabel })}</p>
          <p className="text-sm">
            {t('totals', {
              articles: formatNumber(report.totalArticles, locale),
              units: formatNumber(report.totalUnits, locale),
              value: formatCurrency(report.totalValueAtCost, locale, currency),
            })}
          </p>
        </header>

        <div className="border-hair rounded-2xl border bg-white p-4 print:border-0 print:bg-transparent print:p-0">
          <div className="mb-3 flex items-baseline justify-between print:hidden">
            <h2 className="text-ink text-sm font-semibold">{t('summary')}</h2>
            <span className="text-ink-3 font-mono text-[11px]">{dateLabel}</span>
          </div>
          <div className="text-ink-2 grid grid-cols-3 gap-2 text-xs print:hidden">
            <Metric
              label={t('total_articles')}
              value={formatNumber(report.totalArticles, locale)}
            />
            <Metric label={t('total_units')} value={formatNumber(report.totalUnits, locale)} />
            <Metric
              label={t('total_value')}
              value={formatCurrency(report.totalValueAtCost, locale, currency)}
            />
          </div>
        </div>

        {report.rows.length === 0 ? (
          <div
            data-testid="report-empty"
            className="text-ink-3 rounded-2xl border border-dashed border-hair-2 bg-white p-8 text-center text-sm print:hidden"
          >
            {t('empty')}
          </div>
        ) : (
          <ul
            data-testid="report-rows"
            className="space-y-2 print:space-y-0 print:divide-y print:divide-gray-200"
          >
            {report.rows.map(({ article, variants, totalUnits: aTotal }) => (
              <li
                key={article.id}
                data-testid="report-row"
                className="border-hair flex gap-3 rounded-2xl border bg-white p-3 print:rounded-none print:border-0 print:p-2 print:break-inside-avoid"
              >
                <PhotoThumb photoId={article.photo_id} size={48} className="flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-ink truncate text-sm font-semibold">{article.name}</span>
                    <span
                      className={`font-mono flex-shrink-0 text-xs font-bold ${
                        aTotal === 0 ? 'text-bad' : aTotal <= 3 ? 'text-warn' : 'text-ok'
                      }`}
                      data-testid="report-row-total"
                    >
                      {formatNumber(aTotal, locale)}
                    </span>
                  </div>
                  <div className="text-ink-3 mt-0.5 font-mono text-[10.5px]">
                    {[
                      article.internal_code,
                      article.brand,
                      tCategory(article.category, { defaultValue: article.category }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {sized && variants.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {variants.map((v) => (
                        <span
                          key={v.size ?? '__nosize__'}
                          data-testid="report-row-size"
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] ${
                            v.qty === 0
                              ? 'border-hair text-ink-3 bg-paper-deep'
                              : v.qty <= 2
                                ? 'border-warn/40 text-warn bg-warn-soft'
                                : 'border-ok/30 text-ok bg-ok-soft'
                          }`}
                        >
                          <span dir="ltr">{v.size || '—'}</span>
                          <span>·</span>
                          <span>{formatNumber(v.qty, locale)}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* Verify checkbox — printed only. The shopkeeper walks
                      the shop and ticks off matches. */}
                  <div className="hidden print:mt-1 print:flex print:items-center print:gap-2 print:text-[10px]">
                    <span className="inline-block h-3 w-3 border border-gray-400" />
                    <span className="text-gray-600">verified</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </ScreenLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="border-hair rounded-xl border bg-white px-3 py-2">
      <div className="text-ink-3 text-[9px] uppercase tracking-wide">{label}</div>
      <div className="text-ink mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
