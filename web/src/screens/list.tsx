import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { ResultCard } from '../components/result-card';
import { useLive } from '../hooks/use-live';
import { db } from '../db/db';
import { searchArticles, type SearchResult } from '../query/search';

type Sort = 'recent' | 'az' | 'low_stock' | 'high_margin';

// v0.5 ADR-017: dashboard's Items-running-low widget links to
// /list?filter=low. The filter scopes the result set to articles with
// min_stock_threshold set AND total qty below it. Surfaces a clearable
// chip so the merchant knows why their list is narrowed.
type FilterKind = null | 'low';

export function ListScreen(): JSX.Element {
  const { t } = useTranslation('list');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [sort, setSort] = useState<Sort>('recent');
  const [showArchived, setShowArchived] = useState(false);

  const filter: FilterKind = searchParams.get('filter') === 'low' ? 'low' : null;

  const results = useLive<SearchResult[]>(
    () => searchArticles('', { includeArchived: showArchived }, db),
    [showArchived],
    [],
  );

  const filtered = useMemo(() => {
    if (filter !== 'low') return results;
    return results.filter(
      (r) => r.article.min_stock_threshold != null && r.totalQty < r.article.min_stock_threshold,
    );
  }, [results, filter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sort) {
      case 'az':
        copy.sort((a, b) => a.article.name.localeCompare(b.article.name));
        break;
      case 'low_stock':
        copy.sort((a, b) => a.totalQty - b.totalQty);
        break;
      case 'high_margin':
        copy.sort(
          (a, b) =>
            b.article.sale_price_tnd -
            b.article.cost_price_tnd -
            (a.article.sale_price_tnd - a.article.cost_price_tnd),
        );
        break;
      case 'recent':
      default:
        copy.sort((a, b) => (a.article.updated_at < b.article.updated_at ? 1 : -1));
        break;
    }
    return copy;
  }, [filtered, sort]);

  function clearFilter(): void {
    navigate('/list', { replace: true });
  }

  return (
    <ScreenLayout>
      <ShopHeader />
      <div
        data-testid="list-screen"
        className="flex flex-1 flex-col gap-2 px-4 py-3 overflow-y-auto"
      >
        {filter === 'low' ? (
          <button
            type="button"
            data-testid="list-filter-low-chip"
            onClick={clearFilter}
            className="bg-warn-soft text-warn border-warn/30 inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1.5 text-xs font-medium"
          >
            {t('filter_low_active')}
            <X aria-hidden className="h-3 w-3" strokeWidth={2.25} />
          </button>
        ) : null}

        <div data-testid="list-controls" className="flex flex-wrap gap-1.5">
          {(['recent', 'az', 'low_stock', 'high_margin'] as const).map((s) => (
            <button
              key={s}
              type="button"
              data-testid={`sort-${s}`}
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
              className={`rounded-full border px-3 py-1.5 text-xs ${sort === s ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair text-ink-2 bg-white'}`}
            >
              {t(`sort_${s}`)}
            </button>
          ))}
          <label className="ms-auto flex items-center gap-1.5 text-xs">
            <input
              data-testid="show-archived"
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t('show_archived')}
          </label>
        </div>

        {sorted.length === 0 && filter === 'low' ? (
          <p data-testid="list-low-empty" className="text-ink-3 mt-12 text-center text-sm">
            {t('filter_low_empty')}
          </p>
        ) : (
          sorted.map((r) => <ResultCard key={r.article.id} result={r} />)
        )}
      </div>
    </ScreenLayout>
  );
}
