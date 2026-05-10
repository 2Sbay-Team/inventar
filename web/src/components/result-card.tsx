import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { type SearchResult } from '../query/search';
import { PhotoThumb } from './photo-thumb';
import { StockBadge } from './stock-badge';

interface ResultCardProps {
  result: SearchResult;
  // True for the top-ranked result — gets the cognac-tinted card border.
  featured?: boolean;
}

export function ResultCard({ result, featured }: ResultCardProps): JSX.Element {
  const { t } = useTranslation('search');
  const { locale } = useLocale();
  const currency = useCurrency();
  const { article } = result;
  const subtitle = [article.internal_code, article.brand, article.category]
    .filter((s) => s !== null && s !== '')
    .join(' · ');

  // v0.5 ADR-017: low-stock chip surfaces when the merchant set a
  // reorder threshold and current total stock is below it. Vertical-
  // agnostic — the field lives on Article so any article with a
  // non-null threshold gets the chip when low.
  const showLow =
    article.min_stock_threshold != null && result.totalQty < article.min_stock_threshold;

  return (
    <Link
      to={`/article/${article.id}`}
      data-testid="result-card"
      data-article-id={article.id}
      className={`flex gap-3 rounded-2xl border bg-white p-3 transition-colors ${
        featured ? 'border-accent bg-gradient-to-b from-white to-accent-soft/40' : 'border-hair'
      }`}
    >
      <PhotoThumb photoId={article.photo_id} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display truncate text-[13.5px] font-medium leading-tight text-ink">
            {article.name}
          </span>
          <span className="text-ink-2 flex-shrink-0 font-mono text-[11.5px] font-medium" dir="ltr">
            {formatCurrency(article.sale_price_tnd, locale, currency)}
          </span>
        </div>
        <span className="text-ink-4 font-mono text-[10.5px]" dir="ltr">
          {subtitle}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <StockBadge result={result} />
          {showLow ? (
            <span
              data-testid="low-stock-badge"
              className="bg-warn-soft text-warn mt-1.5 inline-block self-start rounded px-2 py-0.5 font-mono text-[10.5px] font-medium"
            >
              {t('low_left', { n: formatNumber(result.totalQty, locale) })}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
