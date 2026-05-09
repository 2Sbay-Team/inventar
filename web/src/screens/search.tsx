import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { BackupBanner } from '../components/backup-banner';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { SearchBar } from '../components/search-bar';
import { ResultCard } from '../components/result-card';
import { db } from '../db/db';
import { searchArticles, type SearchResult } from '../query/search';
import { useLive } from '../hooks/use-live';
import { getRecentSearches, pushRecentSearch } from '../repos/recent-searches';

// SPEC §2.2 — the daily home. Wires together SearchBar, recent chips,
// ResultList, and the two empty states.
export function SearchScreen(): JSX.Element {
  const { t } = useTranslation('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const recents = useLive<string[]>(() => getRecentSearches(db), [], []);

  // Live counts for the header.
  const counts = useLive<{ articles: number; items: number }>(
    async () => {
      const all = await searchArticles('', {}, db);
      const articles = all.length;
      const items = all.reduce((sum, r) => sum + r.totalQty, 0);
      return { articles, items };
    },
    [],
    { articles: 0, items: 0 },
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const r = await searchArticles(query, {}, db);
      if (!cancelled) {
        setResults(r);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Persist query to recents only when the user has typed at least 2 chars
  // and stayed there for the debounce window — i.e., once it's settled.
  useEffect(() => {
    if (query.trim().length < 2) return;
    const handle = window.setTimeout(() => {
      void pushRecentSearch(db, query);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [query]);

  const trimmed = query.trim();
  const showEmptyZero = trimmed === '' && counts.articles === 0;
  const showEmptyMatch = trimmed !== '' && !loading && results.length === 0;

  return (
    <ScreenLayout>
      <ShopHeader articles={counts.articles} items={counts.items} />
      <SearchBar value={query} onChange={setQuery} count={results.length} />
      <BackupBanner />

      {recents.length > 0 ? (
        <div data-testid="recent-row" className="mt-2 flex items-center gap-2 px-5">
          <span className="text-ink-4 font-mono text-[9.5px] uppercase tracking-widest">
            {t('recent')}
          </span>
          {recents.map((r) => (
            <button
              key={r}
              type="button"
              data-testid="recent-chip"
              onClick={() => setQuery(r)}
              className="bg-paper-deep text-ink-2 font-mono rounded-full px-2.5 py-1 text-[11px]"
            >
              {r}
            </button>
          ))}
        </div>
      ) : null}

      <main
        data-testid="search-screen"
        className="flex flex-1 flex-col gap-2 px-4 pb-3 pt-1.5 overflow-y-auto"
      >
        {showEmptyZero ? (
          <EmptyZero />
        ) : showEmptyMatch ? (
          <EmptyMatch query={trimmed} />
        ) : (
          results.map((r, i) => (
            <ResultCard key={r.article.id} result={r} featured={i === 0 && trimmed !== ''} />
          ))
        )}
      </main>
    </ScreenLayout>
  );
}

function EmptyZero(): JSX.Element {
  const { t } = useTranslation('search');
  return (
    <section
      data-testid="empty-zero"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center"
    >
      <svg
        aria-hidden="true"
        width="80"
        height="80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-ink-4"
      >
        <path d="M3 7l9-4 9 4M3 7l9 4 9-4M3 7v10l9 4 9-4V7M12 11v10" />
      </svg>
      <p className="font-display text-ink-2 text-xl">{t('empty_first')}</p>
      <Link
        to="/add"
        data-testid="empty-zero-cta"
        className="bg-accent inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium text-white"
      >
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        {t('empty_first_cta')}
      </Link>
    </section>
  );
}

function EmptyMatch({ query }: { query: string }): JSX.Element {
  const { t } = useTranslation('search');
  return (
    <section
      data-testid="empty-match"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center"
    >
      <p className="text-ink-2 text-sm leading-relaxed">{t('nothing_found', { query })}</p>
      <Link
        to="/add"
        data-testid="empty-match-cta"
        className="border-hair text-ink-2 inline-flex items-center gap-1.5 rounded-xl border bg-white px-4 py-2.5 text-sm"
      >
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.25} />
        {t('add_as_new')}
      </Link>
    </section>
  );
}
