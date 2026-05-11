import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, PackageOpen, TriangleAlert } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { quantityFor } from '../repos/quantity';
import { formatQtyWithUom } from '../config/article-traits';
import { ExpiryScreen } from './expiry';
import { type Article } from '../types';

// v0.5.2 ADR-018 — consolidated /alerts screen. Two tabs:
//   Tab 1: Stock running low — articles where min_stock_threshold IS
//          NOT NULL AND current_stock < threshold. Per-article alerts
//          only (no global low-stock default per spec).
//   Tab 2: Expiring soon — the existing /expiry list. Mounted via the
//          ExpiryScreen sub-component; ExpiryScreen detects the
//          embedded mode via the `chrome` prop and skips its own
//          header.
//
// Tab routing: ?tab=low (default) | ?tab=expiring. /expiry redirects
// to /alerts?tab=expiring via the routes config. Bookmark / external
// link from a pre-v0.5.2 install lands on the correct tab.

type Tab = 'low' | 'expiring';

function parseTab(value: string | null): Tab {
  return value === 'expiring' ? 'expiring' : 'low';
}

export function AlertsScreen(): JSX.Element {
  const { t } = useTranslation('alerts');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const profile = useProfile();
  const [tab, setTab] = useState<Tab>(() => parseTab(params.get('tab')));

  // Keep the tab in sync with the URL query so a deep link via
  // /alerts?tab=expiring lands on the right tab even if the user
  // navigates away and back.
  useEffect(() => {
    setTab(parseTab(params.get('tab')));
  }, [params]);

  function selectTab(next: Tab): void {
    setTab(next);
    navigate(`/alerts?tab=${next}`, { replace: true });
  }

  // The expiring tab is shop-only (fashion has no expiry tracking).
  // Hide it for non-shop verticals.
  const showExpiringTab = profile?.store_type === 'shop';

  return (
    <ScreenLayout>
      <header className="border-hair flex items-center gap-2 border-b bg-white px-3 py-2">
        <button
          type="button"
          data-testid="alerts-back"
          onClick={() => navigate('/', { replace: true })}
          aria-label={t('back')}
          className="text-ink-3 inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-paper-deep"
        >
          <ChevronLeft aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
        <h2 className="font-display text-base font-semibold tracking-tight">{t('title')}</h2>
      </header>

      <div data-testid="alerts-tabs" className="border-hair flex border-b bg-white">
        <button
          type="button"
          data-testid="alerts-tab-low"
          aria-pressed={tab === 'low'}
          onClick={() => selectTab('low')}
          className={`flex-1 px-3 py-2 text-xs font-medium ${
            tab === 'low'
              ? 'text-accent border-accent border-b-2'
              : 'text-ink-3 border-b-2 border-transparent'
          }`}
        >
          {t('tab_low')}
        </button>
        {showExpiringTab ? (
          <button
            type="button"
            data-testid="alerts-tab-expiring"
            aria-pressed={tab === 'expiring'}
            onClick={() => selectTab('expiring')}
            className={`flex-1 px-3 py-2 text-xs font-medium ${
              tab === 'expiring'
                ? 'text-accent border-accent border-b-2'
                : 'text-ink-3 border-b-2 border-transparent'
            }`}
          >
            {t('tab_expiring')}
          </button>
        ) : null}
      </div>

      <main data-testid="alerts-screen" className="flex-1 overflow-y-auto">
        {tab === 'low' ? <LowStockList /> : null}
        {tab === 'expiring' && showExpiringTab ? <ExpiryScreen embedded /> : null}
      </main>
    </ScreenLayout>
  );
}

// ─── Tab 1: Stock running low ────────────────────────────────────────

interface LowRow {
  article: Article;
  totalStock: number;
}

async function computeLowStock(): Promise<LowRow[]> {
  const articles = (await db.articles.toArray()).filter(
    (a) => a.deleted_at === null && a.archived_at === null && a.min_stock_threshold != null,
  );
  const out: LowRow[] = [];
  for (const a of articles) {
    const variants = (await db.variants.where('article_id').equals(a.id).toArray()).filter(
      (v) => v.deleted_at === null,
    );
    let total = 0;
    for (const v of variants) total += await quantityFor(db, v.id);
    if (total < (a.min_stock_threshold ?? 0)) out.push({ article: a, totalStock: total });
  }
  // Most urgent first (lowest stock, ties by name).
  out.sort((x, y) => x.totalStock - y.totalStock || x.article.name.localeCompare(y.article.name));
  return out;
}

function LowStockList(): JSX.Element {
  const { t } = useTranslation('alerts');
  const rows = useLive<LowRow[]>(computeLowStock, [], []);
  if (rows.length === 0) {
    return (
      <p data-testid="alerts-low-empty" className="text-ink-3 mt-12 text-center text-sm">
        {t('low_empty')}
      </p>
    );
  }
  return (
    <ul data-testid="alerts-low-rows" className="space-y-2 p-3">
      {rows.map((row) => (
        <li
          key={row.article.id}
          data-testid={`alerts-low-row-${row.article.internal_code}`}
          className="border-hair flex items-center gap-3 rounded-2xl border bg-white p-3"
        >
          <span className="bg-warn-soft text-warn flex h-8 w-8 items-center justify-center rounded-full">
            <PackageOpen aria-hidden className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="flex flex-1 flex-col">
            <span className="text-ink text-sm font-medium leading-tight">{row.article.name}</span>
            <span className="text-ink-3 mt-0.5 text-[11px]">
              {(() => {
                // v0.5.2.9 — render the stock + threshold with the
                // article's UoM ("250 g / threshold 500 g" for a
                // fish article, "3 / threshold 5" for shoes).
                const uom = row.article.unit_of_measure ?? 'piece';
                const stockFmt = formatQtyWithUom(row.totalStock, uom);
                const stockText =
                  stockFmt.suffix === ''
                    ? String(stockFmt.value)
                    : `${stockFmt.value} ${stockFmt.suffix}`;
                const threshNum = row.article.min_stock_threshold ?? 0;
                const threshFmt = formatQtyWithUom(threshNum, uom);
                const threshText =
                  threshFmt.suffix === ''
                    ? String(threshFmt.value)
                    : `${threshFmt.value} ${threshFmt.suffix}`;
                return t('low_subtitle', { stock: stockText, threshold: threshText });
              })()}
            </span>
          </div>
          <Link
            data-testid={`alerts-low-row-${row.article.internal_code}-open`}
            to={`/article/${row.article.id}`}
            className="text-accent text-xs font-medium"
          >
            {t('open')}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Dual-purpose icon export: keeps this file's surface aligned with the
// dashboard widget icons so that a future shared TabPicker doesn't need
// to re-import.
export { TriangleAlert };
