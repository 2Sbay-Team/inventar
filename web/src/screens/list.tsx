import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { ResultCard } from '../components/result-card';
import { useLive } from '../hooks/use-live';
import { db } from '../db/db';
import { searchArticles, type SearchResult } from '../query/search';

type Sort = 'recent' | 'az' | 'low_stock' | 'high_margin';

export function ListScreen(): JSX.Element {
  const { t } = useTranslation('list');
  const [sort, setSort] = useState<Sort>('recent');
  const [showArchived, setShowArchived] = useState(false);

  const results = useLive<SearchResult[]>(
    () => searchArticles('', { includeArchived: showArchived }, db),
    [showArchived],
    [],
  );

  const sorted = useMemo(() => {
    const copy = [...results];
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
  }, [results, sort]);

  return (
    <ScreenLayout>
      <ShopHeader />
      <div
        data-testid="list-screen"
        className="flex flex-1 flex-col gap-2 px-4 py-3 overflow-y-auto"
      >
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

        {sorted.map((r) => (
          <ResultCard key={r.article.id} result={r} />
        ))}
      </div>
    </ScreenLayout>
  );
}
