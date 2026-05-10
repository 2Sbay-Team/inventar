import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Coins, PackageOpen, TriangleAlert } from 'lucide-react';

import { db } from '../db/db';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { lotsExpiringWithin } from '../repos/lots';
import { expirySnoozeKey, getMeta, META_KEYS } from '../repos/meta';
import { quantityFor } from '../repos/quantity';
import { formatCurrency } from '../i18n/format-currency';
import { type Article, type Movement } from '../types';

const DEFAULT_THRESHOLD_DAYS = 7;

// v0.5 ADR-018: dashboard widgets shown only when
// profile.store_type === 'shop'. Three cards rendered as a unit; each
// is independent enough to fail-soft (an empty result just means a
// "0" badge or hidden card).

export function ShopWidgets(): JSX.Element | null {
  const profile = useProfile();
  if (profile?.store_type !== 'shop') return null;
  return (
    <section data-testid="shop-widgets" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <TodayCloseWidget />
      <ItemsRunningLowWidget />
      <ExpiringSoonWidget />
    </section>
  );
}

// ─── today's close ────────────────────────────────────────────────────

interface TodayClose {
  txnCount: number;
  revenueMillimes: number;
  topSellers: Array<{ name: string; qty: number }>;
}

async function computeTodayClose(): Promise<TodayClose> {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startIso = startOfDay.toISOString();

  // Pull today's sale movements; filter alive in memory because Dexie
  // can't combine the time-range index with a deleted_at predicate.
  const movements = (await db.movements.toArray()).filter(
    (m) => m.deleted_at === null && m.type === 'sale' && m.created_at >= startIso,
  );

  // Articles + variants for join. Catalogues are bounded so reading
  // them whole is cheaper than per-movement gets.
  const variants = await db.variants.toArray();
  const articles = await db.articles.toArray();
  const variantToArticle = new Map<string, string>();
  for (const v of variants) variantToArticle.set(v.id, v.article_id);
  const articleById = new Map<string, Article>();
  for (const a of articles) articleById.set(a.id, a);

  let revenue = 0;
  const txnIds = new Set<string>();
  // Aggregate by ARTICLE for top-sellers, not by variant — the same
  // article scanned twice belongs in one bucket. Decision per the
  // v0.5 plan, Q-I.
  const qtyByArticle = new Map<string, { name: string; qty: number }>();

  for (const m of movements) {
    const sold = Math.abs(m.delta);
    const articleId = variantToArticle.get(m.variant_id);
    if (!articleId) continue;
    const article = articleById.get(articleId);
    if (!article) continue;
    const unit = m.unit_price_tnd ?? article.sale_price_tnd;
    revenue += sold * unit;
    if (m.transaction_id) txnIds.add(m.transaction_id);
    const cur = qtyByArticle.get(articleId);
    if (cur) cur.qty += sold;
    else qtyByArticle.set(articleId, { name: article.name, qty: sold });
  }

  const topSellers = [...qtyByArticle.values()].sort((a, b) => b.qty - a.qty).slice(0, 3);

  // Transactions = number of distinct transaction_ids; for legacy
  // Quick-Adjust sales (transaction_id null) we count each movement as
  // its own transaction so the figure still reflects activity.
  const legacyTxnCount = movements.filter((m) => m.transaction_id == null).length;
  return {
    txnCount: txnIds.size + legacyTxnCount,
    revenueMillimes: revenue,
    topSellers,
  };
}

function TodayCloseWidget(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const { locale } = useLocale();
  const currency = useCurrency();
  const data = useLive<TodayClose>(computeTodayClose, [], {
    txnCount: 0,
    revenueMillimes: 0,
    topSellers: [],
  });
  const summary = useMemo(() => {
    if (data.topSellers.length === 0) return t('today_close_empty');
    const top = data.topSellers[0];
    if (!top) return t('today_close_empty');
    return t('today_close_top', { name: top.name, qty: top.qty });
  }, [data.topSellers, t]);

  return (
    <div data-testid="widget-today-close" className="border-hair rounded-xl border bg-white p-3">
      <div className="text-ink-3 inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-widest">
        <Coins aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        {t('widget_today_close')}
      </div>
      <div
        data-testid="widget-today-close-revenue"
        className="font-display mt-1 text-base font-semibold tabular-nums"
        dir="ltr"
      >
        {formatCurrency(data.revenueMillimes, locale, currency)}
      </div>
      <div className="text-ink-2 mt-0.5 text-[11px]">
        {t('today_close_txn', { n: data.txnCount })}
      </div>
      <div data-testid="widget-today-close-summary" className="text-ink-3 mt-1 text-[11px]">
        {summary}
      </div>
    </div>
  );
}

// ─── items running low ────────────────────────────────────────────────

async function countLowStock(): Promise<number> {
  // Articles with min_stock_threshold set AND total stock below it.
  // Iterate articles, sum stock across alive variants. Cheap at MVP
  // scale (≤500 articles per SPEC §5).
  const articles = (await db.articles.toArray()).filter(
    (a) => a.deleted_at === null && a.archived_at === null && a.min_stock_threshold != null,
  );
  let count = 0;
  for (const a of articles) {
    const variants = (await db.variants.where('article_id').equals(a.id).toArray()).filter(
      (v) => v.deleted_at === null,
    );
    let qty = 0;
    for (const v of variants) qty += await quantityFor(db, v.id);
    if (qty < (a.min_stock_threshold ?? 0)) count += 1;
  }
  return count;
}

function ItemsRunningLowWidget(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const count = useLive<number>(countLowStock, [], 0);
  return (
    <Link
      to="/list?filter=low"
      data-testid="widget-items-low"
      className="border-hair rounded-xl border bg-white p-3"
    >
      <div className="text-ink-3 inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-widest">
        <PackageOpen aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        {t('widget_items_low')}
      </div>
      <div
        data-testid="widget-items-low-count"
        className="font-display mt-1 text-base font-semibold tabular-nums"
        dir="ltr"
      >
        {count}
      </div>
      <div className="text-ink-3 mt-1 text-[11px]">{t('widget_items_low_hint')}</div>
    </Link>
  );
}

// ─── expiring soon ────────────────────────────────────────────────────

async function countExpiringSoon(): Promise<number> {
  const threshold =
    (await getMeta<number>(db, META_KEYS.expiry_threshold_days)) ?? DEFAULT_THRESHOLD_DAYS;
  const rows = await lotsExpiringWithin(db, threshold);
  if (rows.length === 0) return 0;
  // Same snooze filter as the Search-screen banner so the dashboard
  // count agrees with what the merchant sees on the home screen.
  const nowIso = new Date().toISOString();
  let n = 0;
  for (const row of rows) {
    const snoozedUntil = await getMeta<string>(db, expirySnoozeKey(row.lot.variant_id));
    if (snoozedUntil && snoozedUntil > nowIso) continue;
    n += 1;
  }
  return n;
}

function ExpiringSoonWidget(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const count = useLive<number>(countExpiringSoon, [], 0);
  return (
    <Link
      to="/expiry"
      data-testid="widget-expiring-soon"
      className="border-hair rounded-xl border bg-white p-3"
    >
      <div className="text-ink-3 inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-widest">
        <TriangleAlert aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
        {t('widget_expiring')}
      </div>
      <div
        data-testid="widget-expiring-soon-count"
        className="font-display mt-1 text-base font-semibold tabular-nums"
        dir="ltr"
      >
        {count}
      </div>
      <div className="text-ink-3 mt-1 text-[11px]">{t('widget_expiring_hint')}</div>
    </Link>
  );
}

// Suppress unused-export lint when only the parent ShopWidgets is
// imported elsewhere. The Movement re-export keeps tree-shaking happy
// in test bundles.
export type { Movement };
