import { Link } from 'react-router-dom';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { formatCurrency } from '../i18n/format-currency';
import { type SearchResult } from '../query/search';
import { PhotoThumb } from './photo-thumb';
import { StockBadge } from './stock-badge';

interface ResultCardProps {
  result: SearchResult;
  // True for the top-ranked result — gets the cognac-tinted card border.
  featured?: boolean;
}

export function ResultCard({ result, featured }: ResultCardProps): JSX.Element {
  const { locale } = useLocale();
  const currency = useCurrency();
  const { article } = result;
  const subtitle = [article.internal_code, article.brand, article.category]
    .filter((s) => s !== null && s !== '')
    .join(' · ');

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
        <StockBadge result={result} />
      </div>
    </Link>
  );
}
