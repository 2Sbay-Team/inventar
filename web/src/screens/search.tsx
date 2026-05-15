import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, ScanLine, Sparkles } from 'lucide-react';
import { BackupBanner } from '../components/backup-banner';
import { AlertsBanner } from '../components/alerts-banner';
import { ExpiryBanner } from '../components/expiry-banner';
import { InstallBanner } from '../components/install-banner';
import { MigrationBanner } from '../components/migration-banner';
import { ScreenLayout } from '../components/screen-layout';
import { ShopHeader } from '../components/shop-header';
import { SearchBar } from '../components/search-bar';
import { ResultCard } from '../components/result-card';
import { db } from '../db/db';
import { searchArticles, type SearchResult } from '../query/search';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { getRecentSearches, pushRecentSearch } from '../repos/recent-searches';

// SPEC §2.2 — the daily home. Wires together SearchBar, recent chips,
// ResultList, and the two empty states.
export function SearchScreen(): JSX.Element {
  const { t } = useTranslation('search');
  const profile = useProfile();
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
      <InstallBanner />
      <MigrationBanner />
      <AlertsBanner />
      <ExpiryBanner />
      <BackupBanner />

      {recents.length > 0 ? (
        <div
          data-testid="recent-row"
          className="mt-2 flex items-center gap-2 overflow-x-auto px-5 pb-0.5 scrollbar-none"
        >
          <span className="text-ink-3 shrink-0 text-[11px] font-medium uppercase tracking-wider">
            {t('recent')}
          </span>
          {recents.map((r) => (
            <button
              key={r}
              type="button"
              data-testid="recent-chip"
              onClick={() => setQuery(r)}
              className="border-hair bg-white text-ink-2 shrink-0 rounded-full border px-3 py-1.5 text-[12px] transition-colors active:bg-paper-deep"
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
          <EmptyZero shopName={profile?.name ?? ''} />
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

function EmptyZero({ shopName }: { shopName: string }): JSX.Element {
  const { t } = useTranslation('search');
  return (
    <section
      data-testid="empty-zero"
      className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-12 text-center"
    >
      {/* Illustration */}
      <div className="relative flex items-center justify-center">
        <div className="bg-accent/8 h-28 w-28 rounded-full" />
        <div className="bg-accent/12 absolute h-20 w-20 rounded-full" />
        <svg
          aria-hidden="true"
          width="52"
          height="52"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent absolute"
        >
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      </div>

      {/* Text hierarchy */}
      <div className="space-y-2">
        <h2 className="font-display text-ink text-xl font-semibold">
          {shopName ? t('empty_first_named', { name: shopName }) : t('empty_first')}
        </h2>
        <p className="text-ink-3 mx-auto max-w-xs text-sm leading-relaxed">
          {t('empty_first_hint')}
        </p>
      </div>

      {/* CTAs */}
      <div className="flex w-full max-w-xs flex-col gap-2.5">
        <Link
          to="/add"
          data-testid="empty-zero-cta"
          className="bg-accent inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white shadow-sm shadow-accent/20 active:opacity-90"
        >
          <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          {t('empty_first_cta')}
        </Link>
        <Link
          to="/products/new?scan=1"
          data-testid="empty-zero-scan"
          className="border-hair inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border bg-white px-5 text-sm font-medium text-ink-2 active:bg-paper-deep"
        >
          <ScanLine aria-hidden className="h-4 w-4" strokeWidth={2} />
          {t('empty_first_scan')}
        </Link>
      </div>

      {/* Trust signal */}
      <p className="text-ink-4 flex items-center gap-1.5 text-[11px]">
        <Sparkles aria-hidden className="h-3 w-3" />
        {t('empty_first_offline_hint')}
      </p>
    </section>
  );
}

function EmptyMatch({ query }: { query: string }): JSX.Element {
  const { t } = useTranslation('search');
  return (
    <section
      data-testid="empty-match"
      className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-12 text-center"
    >
      <div className="bg-paper-deep flex h-14 w-14 items-center justify-center rounded-2xl">
        <svg
          aria-hidden="true"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-ink-3"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35M11 8v6M8 11h6" />
        </svg>
      </div>
      <div className="space-y-1.5">
        <p className="font-display text-ink text-base font-medium">{t('nothing_found_title')}</p>
        <p className="text-ink-3 text-sm leading-relaxed">{t('nothing_found', { query })}</p>
      </div>
      <Link
        to="/add"
        data-testid="empty-match-cta"
        className="bg-accent inline-flex min-h-[44px] items-center gap-2 rounded-2xl px-5 text-sm font-semibold text-white active:opacity-90"
      >
        <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
        {t('add_as_new')}
      </Link>
    </section>
  );
}
