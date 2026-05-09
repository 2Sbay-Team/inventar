import { useTranslation } from 'react-i18next';
import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';
import { type SearchResult } from '../query/search';

interface StockBadgeProps {
  result: SearchResult;
}

// SPEC §2.2 stock badge variants:
//   - query mentions a size and it's in stock → "In stock · N in size X"
//   - query mentions a size and it's out → "X out · A and B in stock"
//   - no size in query → "N pairs total · X sizes"
export function StockBadge({ result }: StockBadgeProps): JSX.Element {
  const { t } = useTranslation('search');
  const { locale } = useLocale();
  const fmt = (n: number): string => formatNumber(n, locale);
  const inStockSizes = result.sizeStock.filter((s) => s.qty > 0);

  if (result.matchedSize !== null) {
    const matched = result.sizeStock.find((s) => s.size === result.matchedSize);
    if (matched && matched.qty > 0) {
      return (
        <span
          data-testid="stock-badge"
          data-variant="ok"
          className="bg-ok-soft text-ok mt-1.5 inline-block self-start rounded px-2 py-0.5 font-mono text-[10.5px] font-medium"
        >
          {t('in_stock_with_size', { n: fmt(matched.qty), size: result.matchedSize })}
        </span>
      );
    }
    const neighbours = inStockSizes.map((s) => s.size).join(', ');
    return (
      <span
        data-testid="stock-badge"
        data-variant="warn"
        className="bg-warn-soft text-warn mt-1.5 inline-block self-start rounded px-2 py-0.5 font-mono text-[10.5px] font-medium"
      >
        {t('size_out_with_neighbours', { size: result.matchedSize, neighbours: neighbours || '—' })}
      </span>
    );
  }

  return (
    <span
      data-testid="stock-badge"
      data-variant="info"
      className={`mt-1.5 inline-block self-start rounded px-2 py-0.5 font-mono text-[10.5px] font-medium ${
        result.totalQty > 0 ? 'bg-ok-soft text-ok' : 'bg-paper-deep text-ink-3'
      }`}
    >
      {t('summary', { pairs: fmt(result.totalQty), sizes: fmt(inStockSizes.length) })}
    </span>
  );
}
