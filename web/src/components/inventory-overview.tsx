import { useTranslation } from 'react-i18next';
import { AlertTriangle, Boxes, Package, Wallet } from 'lucide-react';
import { db } from '../db/db';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { quantityFor } from '../repos/quantity';

const LOW_STOCK_THRESHOLD = 3;

interface CategoryBucket {
  category: string;
  units: number;
}

interface LowStockArticle {
  id: string;
  name: string;
  internal_code: string;
  totalUnits: number;
}

interface OverviewMetrics {
  totalUnits: number;
  totalValueAtCost: number;
  totalValueAtSale: number;
  articleCount: number;
  outOfStockCount: number;
  lowStockCount: number;
  byCategory: CategoryBucket[];
  lowStockArticles: LowStockArticle[];
}

const EMPTY: OverviewMetrics = {
  totalUnits: 0,
  totalValueAtCost: 0,
  totalValueAtSale: 0,
  articleCount: 0,
  outOfStockCount: 0,
  lowStockCount: 0,
  byCategory: [],
  lowStockArticles: [],
};

// Walks the live catalogue and aggregates per-article totals. The shape
// is small enough (article count capped at ~hundreds) that re-running on
// every Dexie change via useLive is fine.
async function computeOverview(): Promise<OverviewMetrics> {
  const [articles, variants] = await Promise.all([
    db.articles
      .where('deleted_at')
      .equals('NULL')
      .or('deleted_at')
      .equals(null as never)
      .toArray()
      .catch(async () => (await db.articles.toArray()).filter((a) => a.deleted_at === null)),
    db.variants.toArray(),
  ]);
  const aliveArticles = articles.filter((a) => a.deleted_at === null);
  const articleById = new Map(aliveArticles.map((a) => [a.id, a]));

  // Variant ids grouped per article so we can sum without re-walking.
  const variantsByArticle = new Map<string, typeof variants>();
  for (const v of variants) {
    if (v.deleted_at !== null) continue;
    if (!articleById.has(v.article_id)) continue;
    const list = variantsByArticle.get(v.article_id) ?? [];
    list.push(v);
    variantsByArticle.set(v.article_id, list);
  }

  const perArticleUnits = new Map<string, number>();
  for (const article of aliveArticles) {
    const vlist = variantsByArticle.get(article.id) ?? [];
    let units = 0;
    for (const v of vlist) units += await quantityFor(db, v.id);
    perArticleUnits.set(article.id, units);
  }

  let totalUnits = 0;
  let totalValueAtCost = 0;
  let totalValueAtSale = 0;
  const categoryUnits = new Map<string, number>();
  const lowStock: LowStockArticle[] = [];
  let outOfStockCount = 0;

  for (const article of aliveArticles) {
    if (article.archived_at !== null) continue;
    const units = perArticleUnits.get(article.id) ?? 0;
    totalUnits += units;
    totalValueAtCost += units * article.cost_price_tnd;
    totalValueAtSale += units * article.sale_price_tnd;
    const cat = article.category || 'other';
    categoryUnits.set(cat, (categoryUnits.get(cat) ?? 0) + units);
    if (units === 0) {
      outOfStockCount += 1;
    } else if (units <= LOW_STOCK_THRESHOLD) {
      lowStock.push({
        id: article.id,
        name: article.name,
        internal_code: article.internal_code,
        totalUnits: units,
      });
    }
  }

  const byCategory = Array.from(categoryUnits.entries())
    .map(([category, units]) => ({ category, units }))
    .sort((a, b) => b.units - a.units);

  // Limit to a sensible top-N for the visible list — the alert is the
  // gist, not a full catalogue dump.
  lowStock.sort((a, b) => a.totalUnits - b.totalUnits);
  const lowStockArticles = lowStock.slice(0, 6);

  const aliveCount = aliveArticles.filter((a) => a.archived_at === null).length;

  return {
    totalUnits,
    totalValueAtCost,
    totalValueAtSale,
    articleCount: aliveCount,
    outOfStockCount,
    lowStockCount: lowStock.length,
    byCategory,
    lowStockArticles,
  };
}

export function InventoryOverview(): JSX.Element {
  const { t } = useTranslation('dashboard');
  const { t: tCategory } = useTranslation('category');
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const sized = profile?.store_type === 'shoes' || profile?.store_type === 'clothes';
  const metrics = useLive<OverviewMetrics>(computeOverview, [], EMPTY) ?? EMPTY;

  const maxBucket = metrics.byCategory[0]?.units ?? 0;

  return (
    <section data-testid="inventory-overview" className="space-y-3">
      <h3 className="font-display text-ink text-base font-semibold">{t('inventory_title')}</h3>

      <div className="grid grid-cols-2 gap-2">
        <Tile
          testId="inv-units"
          icon={Boxes}
          label={t(sized ? 'inv_units_pairs' : 'inv_units_items')}
          value={formatNumber(metrics.totalUnits, locale)}
        />
        <Tile
          testId="inv-value-cost"
          icon={Wallet}
          label={t('inv_value_cost')}
          value={formatCurrency(metrics.totalValueAtCost, locale, currency)}
        />
        <Tile
          testId="inv-articles"
          icon={Package}
          label={t('inv_article_count')}
          value={formatNumber(metrics.articleCount, locale)}
        />
        <Tile
          testId="inv-low-stock"
          icon={AlertTriangle}
          label={t('inv_low_stock')}
          value={formatNumber(metrics.lowStockCount + metrics.outOfStockCount, locale)}
          tone={metrics.lowStockCount + metrics.outOfStockCount > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {metrics.byCategory.length > 0 ? (
        <div data-testid="inv-by-category" className="border-hair rounded-2xl border bg-white p-4">
          <h4 className="text-ink text-sm font-medium mb-3">{t('inv_by_category')}</h4>
          <div className="space-y-2">
            {metrics.byCategory.slice(0, 6).map(({ category, units }) => {
              const pct = maxBucket > 0 ? Math.max(2, Math.round((units / maxBucket) * 100)) : 0;
              return (
                <div key={category} className="flex items-center gap-2 text-xs">
                  <span className="text-ink-2 w-20 flex-shrink-0 truncate">
                    {tCategory(category, { defaultValue: category })}
                  </span>
                  <div className="bg-paper-deep relative h-5 flex-1 overflow-hidden rounded-md">
                    <div
                      className="bg-accent h-full rounded-md transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-ink-2 w-10 flex-shrink-0 text-end font-mono">
                    {formatNumber(units, locale)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {metrics.lowStockArticles.length > 0 ? (
        <div
          data-testid="inv-low-stock-list"
          className="border-warn/30 bg-warn-soft/50 rounded-2xl border p-4"
        >
          <h4 className="text-ink mb-2 inline-flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle aria-hidden className="text-warn h-4 w-4" strokeWidth={2.25} />
            {t('inv_low_stock_list_title')}
          </h4>
          <ul className="space-y-1">
            {metrics.lowStockArticles.map((a) => (
              <li
                key={a.id}
                data-testid="inv-low-stock-item"
                className="flex items-center justify-between text-xs"
              >
                <span className="text-ink-2 truncate">
                  <span className="text-ink-4 font-mono">{a.internal_code}</span> {a.name}
                </span>
                <span
                  className={`font-mono flex-shrink-0 ${a.totalUnits === 0 ? 'text-bad' : 'text-warn'}`}
                >
                  {formatNumber(a.totalUnits, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

interface TileProps {
  testId: string;
  icon: typeof Boxes;
  label: string;
  value: string;
  tone?: 'neutral' | 'warn';
}

function Tile({ testId, icon: Icon, label, value, tone = 'neutral' }: TileProps): JSX.Element {
  return (
    <div
      data-testid={testId}
      className={`border-hair rounded-2xl border p-3 ${
        tone === 'warn' ? 'bg-warn-soft/40' : 'bg-white'
      }`}
    >
      <div className="text-ink-3 inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide">
        <Icon
          aria-hidden
          className={`h-3.5 w-3.5 ${tone === 'warn' ? 'text-warn' : 'text-accent'}`}
          strokeWidth={2.25}
        />
        {label}
      </div>
      <div className="text-ink mt-1 font-mono text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
