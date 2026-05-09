import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenLayout } from '../components/screen-layout';
import { SizeGrid } from '../components/size-grid';
import { ActivityFeed } from '../components/activity-feed';
import { QuickAdjustSheet, type QuickAdjustTarget } from '../components/quick-adjust-sheet';
import { MoreMenuSheet } from '../components/more-menu-sheet';
import { PhotoThumb } from '../components/photo-thumb';
import { Minus, Plus } from 'lucide-react';
import { STORE_TYPES } from '../config/store-types';
import { useArticleDetail } from '../hooks/use-article-detail';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { type MovementType, type Variant } from '../types';
import { type SizeGridCell } from '../repos/quantity';

export function ArticleDetailScreen(): JSX.Element {
  const { t } = useTranslation('article');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const detail = useArticleDetail(id);
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const needsSizes = STORE_TYPES[profile?.store_type ?? 'shoes'].has_sizes;

  const [adjustTarget, setAdjustTarget] = useState<QuickAdjustTarget | null>(null);
  const [adjustReason, setAdjustReason] = useState<MovementType>('sale');
  const [moreOpen, setMoreOpen] = useState(false);

  const variantsById = useMemo(() => {
    const m = new Map<string, Variant>();
    if (!detail?.article) return m;
    // We synthesise lightweight variant entries from the size grid since
    // the activity feed only needs the size — the full variant rows aren't
    // part of the hook's payload.
    for (const cell of detail.sizes) {
      m.set(cell.variant_id, {
        id: cell.variant_id,
        article_id: detail.article.id,
        size: cell.size,
        hidden: cell.hidden,
        updated_at: '',
        deleted_at: null,
      });
    }
    return m;
  }, [detail]);

  if (detail === undefined)
    return (
      <ScreenLayout hideNav>
        <main className="flex-1" />
      </ScreenLayout>
    );
  if (!detail.article) {
    return (
      <ScreenLayout hideNav>
        <main data-testid="article-not-found" className="flex flex-1 items-center justify-center">
          <p className="text-ink-3 text-sm">{tCommon('dash')}</p>
        </main>
      </ScreenLayout>
    );
  }

  const article = detail.article;
  const totalQty = detail.sizes.reduce((sum, c) => sum + Math.max(0, c.qty), 0);

  function openAdjust(cell: SizeGridCell, reason: MovementType): void {
    setAdjustReason(reason);
    setAdjustTarget({
      variantId: cell.variant_id,
      size: cell.size,
      articleName: article.name,
      currentQty: cell.qty,
    });
  }

  const sizes = detail.sizes;
  function openSellTopVariant(): void {
    const cell = sizes.find((c) => c.qty > 0) ?? sizes[0];
    if (!cell) return;
    openAdjust(cell, 'sale');
  }

  function openRestockTopVariant(): void {
    const cell = sizes[0];
    if (!cell) return;
    openAdjust(cell, 'purchase');
  }

  return (
    <ScreenLayout hideNav>
      <header
        data-testid="detail-bar"
        className="border-hair flex flex-shrink-0 items-center justify-between border-b px-4 py-3"
      >
        <button
          type="button"
          data-testid="detail-back"
          onClick={() => navigate(-1)}
          className="text-ink"
          aria-label={tCommon('back')}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="detail-sku"
          onClick={() => void navigator.clipboard?.writeText(article.internal_code)}
          className="font-mono text-xs font-medium text-ink"
          aria-label={t('copy_sku')}
          dir="ltr"
        >
          {article.internal_code}
        </button>
        <button
          type="button"
          data-testid="detail-more"
          onClick={() => setMoreOpen(true)}
          className="text-ink"
          aria-label={tCommon('edit')}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </svg>
        </button>
      </header>

      <div
        data-testid="hero-photo"
        className="bg-paper-deep mx-4 mt-4 aspect-[16/11] overflow-hidden rounded-2xl"
      >
        <PhotoThumb
          photoId={article.photo_id}
          size={320}
          className="!h-full !w-full !rounded-2xl border-0"
          testId="hero-photo-img"
        />
      </div>

      <section className="px-5 pb-3 pt-3">
        <h3 className="font-display text-lg font-medium tracking-tight">{article.name}</h3>
        <div className="text-ink-3 mt-1 text-xs">
          {article.colors.join(' · ')}
          {article.brand ? ` · ${article.brand}` : ''}
          {' · '}
          {article.category}
        </div>
        <div className="border-hair mt-3 flex items-center gap-4 border-t pt-3">
          <div className="flex flex-col">
            <span className="text-ink-4 font-mono text-[9.5px] uppercase tracking-widest">
              {t('price_cost')}
            </span>
            <span
              data-testid="price-cost"
              className="font-mono text-[13px] font-semibold tabular-nums"
              dir="ltr"
            >
              {formatCurrency(article.cost_price_tnd, locale, currency)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-ink-4 font-mono text-[9.5px] uppercase tracking-widest">
              {t('price_sale')}
            </span>
            <span
              data-testid="price-sale"
              className="font-mono text-[13px] font-semibold tabular-nums"
              dir="ltr"
            >
              {formatCurrency(article.sale_price_tnd, locale, currency)}
            </span>
          </div>
          <span
            data-testid="stock-total"
            className={`ms-auto rounded-full px-3 py-1 text-[11px] font-medium ${totalQty > 0 ? 'bg-ok-soft text-ok' : 'bg-paper-deep text-ink-3'}`}
          >
            {totalQty > 0
              ? t('in_stock_total', { n: formatNumber(totalQty, locale) })
              : t('out_of_stock')}
          </span>
        </div>
      </section>

      {needsSizes ? (
        <section className="border-hair border-t px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="font-display text-[13px] font-medium">{t('sizes_title')}</h4>
            <span className="text-ink-4 text-[10.5px]">{t('sizes_hint')}</span>
          </div>
          <SizeGrid
            cells={detail.sizes}
            onCellClick={(cell) => openAdjust(cell, cell.qty > 0 ? 'sale' : 'purchase')}
          />
        </section>
      ) : null}

      <section className="border-hair flex-1 overflow-y-auto border-t px-5 py-4">
        <h4 className="font-display mb-2 text-[13px] font-medium">{t('activity_title')}</h4>
        <ActivityFeed movements={detail.recent} variantsById={variantsById} />
      </section>

      <div
        data-testid="action-bar"
        className="border-hair flex flex-shrink-0 gap-2 border-t bg-white px-3 py-3 pb-5"
      >
        <button
          type="button"
          data-testid="action-sell"
          onClick={openSellTopVariant}
          className="border-hair inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-white py-3 text-sm font-medium"
        >
          <Minus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          {t('action_sell')}
        </button>
        <button
          type="button"
          data-testid="action-restock"
          onClick={openRestockTopVariant}
          className="bg-ink inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl py-3 text-sm font-medium text-white"
        >
          <Plus aria-hidden className="h-4 w-4" strokeWidth={2.5} />
          {t('action_restock')}
        </button>
      </div>

      <QuickAdjustSheet
        open={adjustTarget !== null}
        target={adjustTarget}
        defaultReason={adjustReason}
        onClose={() => setAdjustTarget(null)}
      />
      <MoreMenuSheet
        open={moreOpen}
        article={article}
        onClose={() => setMoreOpen(false)}
        onArchived={() => navigate('/', { replace: true })}
        onDeleted={() => navigate('/', { replace: true })}
      />
    </ScreenLayout>
  );
}
