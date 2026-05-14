import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ScreenLayout } from '../components/screen-layout';
import { SizeGrid } from '../components/size-grid';
import { ActivityFeed } from '../components/activity-feed';
import { QuickAdjustSheet, type QuickAdjustTarget } from '../components/quick-adjust-sheet';
import { MoreMenuSheet } from '../components/more-menu-sheet';
import { PhotoThumb } from '../components/photo-thumb';
import * as Dialog from '@radix-ui/react-dialog';
import { Camera, Minus, Plus, QrCode, X } from 'lucide-react';
import { ArticleQR } from '../components/article-qr';
import { ModernQRCode } from '../components/ModernQRCode';
import { useQrBranding } from '../hooks/use-qr-branding';
import { flagEnabled } from '../utils/feature-flags';
import {
  articleHasExpiry,
  articleHasSizes,
  formatQtyWithUom,
  internalPriceToInput,
} from '../config/article-traits';
import { useArticleDetail } from '../hooks/use-article-detail';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { db } from '../db/db';
import { updateArticle } from '../repos/articles';
import { storePhoto, softDeletePhoto } from '../repos/photos';
import { type MovementType, type Variant } from '../types';
import { type SizeGridCell } from '../repos/quantity';

export function ArticleDetailScreen(): JSX.Element {
  const { t } = useTranslation('article');
  const { t: tCommon } = useTranslation('common');
  const { t: tColor } = useTranslation('color');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const detail = useArticleDetail(id);
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  // v0.5.2.9 (Phase B): article-level trait overrides resolved via
  // helpers — fall back to the store_type default when the article's
  // override is null. needsSizes / showMinStockEditor land after the
  // article is loaded so the helper has a row to read.

  const [adjustTarget, setAdjustTarget] = useState<QuickAdjustTarget | null>(null);
  const [adjustReason, setAdjustReason] = useState<MovementType>('sale');
  const [moreOpen, setMoreOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrBranding = useQrBranding();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // v0.5.2.8 — industry-standard photo-per-colour pattern (Shopify /
  // Lightspeed / WooCommerce / Magento style). The hero photo defaults
  // to article.photo_id. Tapping a colour swatch below switches the
  // hero to that colour's variant photo. Null = use the article-level
  // fallback (current behaviour for first-load and sizeless articles).
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [minStockDraft, setMinStockDraft] = useState<string | null>(null);
  const [minStockSaving, setMinStockSaving] = useState(false);
  // v0.5.2 ADR-023: per-article expiry-alert override. Same shape as
  // the min_stock editor: shop only, optional integer ≥1, null = use
  // the global ShopProfile.expiry_warning_days.
  const [expiryAlertDraft, setExpiryAlertDraft] = useState<string | null>(null);
  const [expiryAlertSaving, setExpiryAlertSaving] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // v0.5.2.8 — one swatch per unique colour found in the article's
  // variants, paired with the variant's photo_id so the strip can
  // render a thumbnail. Order is the natural sort order returned by
  // sizeGridFor (alphabetical with null first); first match for a
  // colour wins, so the photo aligns with the first row of the size
  // matrix for that colour. Empty for sizeless / colourless articles —
  // the UI skips the strip when this list is empty.
  const colorSwatches = useMemo(() => {
    if (!detail?.sizes) return [] as Array<{ color: string; photoId: string | null }>;
    const seen = new Map<string, string | null>();
    for (const cell of detail.sizes) {
      if (cell.color == null) continue;
      if (seen.has(cell.color)) continue;
      seen.set(cell.color, cell.photo_id);
    }
    return Array.from(seen.entries()).map(([color, photoId]) => ({ color, photoId }));
  }, [detail?.sizes]);

  // Hero photo: when the merchant has picked a colour, prefer that
  // colour's variant photo; otherwise fall back to the article-level
  // photo. Always falls back to article.photo_id when the variant has
  // none — same fallback rule the storefront-style pattern uses.
  const heroPhotoId = useMemo(() => {
    if (selectedColor == null) return detail?.article?.photo_id ?? null;
    const match = colorSwatches.find((s) => s.color === selectedColor);
    return match?.photoId ?? detail?.article?.photo_id ?? null;
  }, [selectedColor, colorSwatches, detail?.article?.photo_id]);

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
        // Synthetic stub passed to ActivityFeed — the feed only renders
        // size, so colour/photo are filled with the cell's values so the
        // colour-swatch strip below has its photo_id available too.
        color: cell.color ?? null,
        photo_id: cell.photo_id,
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
  // Phase B: read traits via the helpers so a per-article override wins
  // over the store_type default (null on the article = use store_type).
  const needsSizes = articleHasSizes(article, profile ?? null);
  const showMinStockEditor = articleHasExpiry(article, profile ?? null);

  function openAdjust(cell: SizeGridCell, reason: MovementType): void {
    setAdjustReason(reason);
    setAdjustTarget({
      variantId: cell.variant_id,
      size: cell.size,
      articleName: article.name,
      currentQty: cell.qty,
      // Pass the catalogue price so the sheet can preview sale / refund
      // totals without a separate fetch.
      unitPriceTnd: article.sale_price_tnd,
      // v0.5.2.9 (UoM): drives the qty-input variant (stepper vs decimal).
      unitOfMeasure: article.unit_of_measure,
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

  async function handleNewPhoto(file: File): Promise<void> {
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const previousPhotoId = article.photo_id;
      const { compressPhoto, PhotoTooLargeError } = await import('../utils/compress-photo');
      let compressed;
      try {
        compressed = await compressPhoto(file);
      } catch (err) {
        if (err instanceof PhotoTooLargeError) {
          setPhotoError(t('photo_too_large'));
        } else {
          setPhotoError(t('photo_failed'));
        }
        return;
      }
      const stored = await storePhoto(db, {
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      await updateArticle(db, article.id, { photo_id: stored.id });
      if (previousPhotoId) {
        // Soft-delete keeps the row for any in-flight backup; the next
        // hard-delete cascade or import-replace will reclaim the bytes.
        await softDeletePhoto(db, previousPhotoId);
      }
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
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
          data-testid="detail-qr"
          onClick={() => setQrOpen(true)}
          className="text-ink-3 hover:text-accent ms-1 inline-flex items-center"
          aria-label={t('show_qr')}
        >
          <QrCode aria-hidden className="h-4 w-4" strokeWidth={2} />
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
        className="bg-paper-deep relative mx-4 mt-4 aspect-[16/11] overflow-hidden rounded-2xl"
      >
        <PhotoThumb
          photoId={heroPhotoId}
          size={320}
          className="!h-full !w-full !rounded-2xl border-0"
          testId="hero-photo-img"
        />
        <button
          type="button"
          data-testid="hero-photo-change"
          onClick={() => photoInputRef.current?.click()}
          disabled={photoBusy}
          aria-label={t('menu_new_photo')}
          className="absolute bottom-2 end-2 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-[12px] font-medium text-ink shadow-[0_2px_8px_rgba(0,0,0,0.18)] backdrop-blur-sm transition-all hover:bg-white active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Camera aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
          <span>{photoBusy ? tCommon('saving') : t('menu_new_photo')}</span>
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="hero-photo-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleNewPhoto(f);
          }}
        />
      </div>

      {photoError ? (
        <div
          data-testid="hero-photo-error"
          role="alert"
          className="text-bad bg-bad/5 border-bad/20 mx-4 mt-2 rounded-xl border px-3 py-2 text-xs"
        >
          {photoError}
        </div>
      ) : null}

      {colorSwatches.length > 0 ? (
        <div data-testid="color-swatch-strip" className="mx-4 mt-3 flex gap-2 overflow-x-auto pb-1">
          {colorSwatches.map((s) => {
            const active = selectedColor === s.color;
            return (
              <button
                key={s.color}
                type="button"
                data-testid={`color-swatch-${s.color}`}
                aria-pressed={active}
                onClick={() => setSelectedColor(active ? null : s.color)}
                className={`flex flex-shrink-0 flex-col items-center gap-1 rounded-xl border bg-white px-2 py-1.5 transition-all active:scale-[0.97] ${
                  active
                    ? 'border-accent bg-accent-soft shadow-[0_2px_8px_rgba(255,107,53,0.18)]'
                    : 'border-hair hover:border-accent/40'
                }`}
              >
                <span className="block h-12 w-12 overflow-hidden rounded-lg">
                  <PhotoThumb
                    photoId={s.photoId}
                    size={48}
                    className="!h-full !w-full !rounded-lg border-0"
                    testId={`color-swatch-thumb-${s.color}`}
                  />
                </span>
                <span
                  className={`text-[10px] font-medium leading-tight ${
                    active ? 'text-accent-ink' : 'text-ink-2'
                  }`}
                >
                  {tColor(s.color)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

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
              {formatCurrency(
                internalPriceToInput(article.cost_price_tnd, article.unit_of_measure),
                locale,
                currency,
              )}
              {article.unit_of_measure === 'piece' ? '' : `/${article.unit_of_measure}`}
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
              {formatCurrency(
                internalPriceToInput(article.sale_price_tnd, article.unit_of_measure),
                locale,
                currency,
              )}
              {article.unit_of_measure === 'piece' ? '' : `/${article.unit_of_measure}`}
            </span>
          </div>
          <span
            data-testid="stock-total"
            className={`ms-auto rounded-full px-3 py-1 text-[11px] font-medium ${totalQty > 0 ? 'bg-ok-soft text-ok' : 'bg-paper-deep text-ink-3'}`}
          >
            {totalQty > 0
              ? (() => {
                  // v0.5.2.9 (UoM): format stock total with the article's
                  // unit (e.g. "850 g", "1.25 kg"). For 'piece' UoM the
                  // suffix is empty so the existing string stays clean.
                  const { value, suffix } = formatQtyWithUom(totalQty, article.unit_of_measure);
                  const formatted = formatNumber(value, locale);
                  return suffix === ''
                    ? t('in_stock_total', { n: formatted })
                    : t('in_stock_total_uom', { n: formatted, uom: suffix });
                })()
              : t('out_of_stock')}
          </span>
        </div>

        {showMinStockEditor ? (
          <div data-testid="min-stock-editor" className="mt-3 flex items-center gap-2">
            <label
              htmlFor="detail-min-stock"
              className="text-ink-3 font-mono text-[10.5px] uppercase tracking-widest"
            >
              {t('min_stock_label')}
            </label>
            <input
              id="detail-min-stock"
              data-testid="detail-min-stock"
              type="number"
              inputMode="numeric"
              min={0}
              value={
                minStockDraft ??
                (article.min_stock_threshold === null ? '' : String(article.min_stock_threshold))
              }
              onChange={(e) => setMinStockDraft(e.target.value)}
              onBlur={async () => {
                const draft = minStockDraft;
                if (draft === null) return;
                const trimmed = draft.trim();
                const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
                const next =
                  parsed === null ? null : Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                if (next === article.min_stock_threshold) {
                  setMinStockDraft(null);
                  return;
                }
                setMinStockSaving(true);
                try {
                  await updateArticle(db, article.id, { min_stock_threshold: next });
                } finally {
                  setMinStockDraft(null);
                  setMinStockSaving(false);
                }
              }}
              placeholder={t('min_stock_placeholder')}
              className="border-hair w-20 rounded-lg border bg-white px-2 py-1 text-end font-mono text-xs"
            />
            {minStockSaving ? (
              <span className="text-ink-3 text-[10.5px]">{tCommon('saving')}</span>
            ) : null}
          </div>
        ) : null}

        {/* v0.5.2 ADR-023: per-article expiry-alert threshold override.
            Shop articles with at least one Lot fire alerts on this
            value when set; null falls back to the global expiry_warning_
            days from ShopProfile. */}
        {showMinStockEditor ? (
          <div data-testid="expiry-alert-editor" className="mt-2 flex items-center gap-2">
            <label
              htmlFor="detail-expiry-alert"
              className="text-ink-3 font-mono text-[10.5px] uppercase tracking-widest"
            >
              {t('expiry_alert_label')}
            </label>
            <input
              id="detail-expiry-alert"
              data-testid="detail-expiry-alert"
              type="number"
              inputMode="numeric"
              min={0}
              value={
                expiryAlertDraft ??
                (article.expiry_alert_days === null ? '' : String(article.expiry_alert_days))
              }
              onChange={(e) => setExpiryAlertDraft(e.target.value)}
              onBlur={async () => {
                const draft = expiryAlertDraft;
                if (draft === null) return;
                const trimmed = draft.trim();
                const parsed = trimmed === '' ? null : Number.parseInt(trimmed, 10);
                const next =
                  parsed === null ? null : Number.isFinite(parsed) && parsed > 0 ? parsed : null;
                if (next === article.expiry_alert_days) {
                  setExpiryAlertDraft(null);
                  return;
                }
                setExpiryAlertSaving(true);
                try {
                  await updateArticle(db, article.id, { expiry_alert_days: next });
                } finally {
                  setExpiryAlertDraft(null);
                  setExpiryAlertSaving(false);
                }
              }}
              placeholder={t('expiry_alert_placeholder')}
              className="border-hair w-20 rounded-lg border bg-white px-2 py-1 text-end font-mono text-xs"
            />
            {expiryAlertSaving ? (
              <span className="text-ink-3 text-[10.5px]">{tCommon('saving')}</span>
            ) : null}
          </div>
        ) : null}
      </section>

      {needsSizes ? (
        <section className="border-hair border-t px-5 py-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="font-display text-[13px] font-medium">{t('sizes_title')}</h4>
            <span className="text-ink-4 text-[10.5px]">{t('sizes_hint')}</span>
          </div>
          <SizeGrid
            cells={detail.sizes}
            unitOfMeasure={article.unit_of_measure}
            onCellClick={(cell) => openAdjust(cell, cell.qty > 0 ? 'sale' : 'purchase')}
          />
        </section>
      ) : null}

      <section className="border-hair flex-1 overflow-y-auto border-t px-5 py-4">
        <h4 className="font-display mb-2 text-[13px] font-medium">{t('activity_title')}</h4>
        <ActivityFeed
          movements={detail.recent}
          variantsById={variantsById}
          unitOfMeasure={article.unit_of_measure}
        />
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

      <Dialog.Root open={qrOpen} onOpenChange={setQrOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            data-testid="article-qr-dialog"
            className="bg-paper fixed inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="font-display inline-flex items-center gap-2 text-base font-semibold">
                <QrCode aria-hidden className="h-5 w-5" strokeWidth={2} />
                {t('show_qr')}
              </Dialog.Title>
              <Dialog.Close
                type="button"
                className="text-ink-3 hover:text-ink rounded-full p-1"
                aria-label={tCommon('close')}
              >
                <X aria-hidden className="h-5 w-5" strokeWidth={2} />
              </Dialog.Close>
            </div>
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className="border-hair rounded-2xl border bg-white p-4">
                {flagEnabled('modern_qr_style') ? (
                  <ModernQRCode
                    value={`https://inventar.hoodhood.ai/article/${article.id}`}
                    brandColor={profile?.brand_primary_color}
                    logoUrl={qrBranding?.logoDataUrl}
                    centerText={qrBranding?.text}
                    size={224}
                    testId="article-qr"
                  />
                ) : (
                  <ArticleQR
                    articleId={article.id}
                    size={224}
                    branding={qrBranding}
                    brandColor={profile?.brand_primary_color}
                  />
                )}
              </div>
              <div className="text-center">
                <p className="text-ink text-sm font-medium">{article.name}</p>
                <p className="text-ink-3 font-mono text-xs">{article.internal_code}</p>
              </div>
              <p className="text-ink-3 max-w-xs text-center text-xs leading-relaxed">
                {t('qr_hint')}
              </p>
              <button
                type="button"
                data-testid="qr-dialog-print"
                onClick={() => navigate(`/article/${article.id}/label`)}
                className="bg-accent mt-2 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white"
              >
                {t('print_label')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ScreenLayout>
  );
}
