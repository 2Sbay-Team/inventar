import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Printer } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { ArticleQR } from '../components/article-qr';
import { ArticleBarcode } from '../components/article-barcode';
import { db } from '../db/db';
import { getArticle } from '../repos/articles';
import { sizeGridFor } from '../repos/quantity';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { upsertProfile } from '../repos/profile';
import { articleHasColors, articleHasSizes } from '../config/article-traits';
import { variantCode } from '../utils/variant-code';
import { type Article } from '../types';
import { type SizeGridCell } from '../repos/quantity';

type ContentMode = 'both' | 'qr_only' | 'barcode_only';
type LayoutMode = 'sheet_3x4' | 'sheet_2x5' | 'sheet_4x6';
type SheetMode = 'all_variants' | 'colors_only' | 'article_only';

const PER_SHEET: Record<LayoutMode, number> = {
  sheet_3x4: 12,
  sheet_2x5: 10,
  sheet_4x6: 24,
};

interface LabelCell {
  variantId: string | null;
  variantLabel: string;
  code: string;
}

function buildCells(
  article: Article,
  sizes: SizeGridCell[],
  mode: SheetMode,
  hasColors: boolean,
  hasSizes: boolean,
  focusVariantId: string | null,
): LabelCell[] {
  const ctx = { hasColors, hasSizes };

  if (mode === 'article_only') {
    return [{ variantId: null, variantLabel: '', code: article.internal_code }];
  }

  const visible = sizes.filter((c) => !c.hidden);

  if (mode === 'colors_only') {
    const seen = new Set<string>();
    return visible
      .filter((c) => {
        const k = c.color ?? '';
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((c) => ({
        variantId: c.variant_id,
        variantLabel: c.color ?? '',
        code: variantCode(article, { color: c.color ?? null, size: null }, ctx),
      }));
  }

  // all_variants
  const cells = visible.map((c) => {
    const parts = [c.color, c.size].filter(Boolean);
    return {
      variantId: c.variant_id,
      variantLabel: parts.join(' · '),
      code: variantCode(article, { color: c.color ?? null, size: c.size ?? null }, ctx),
    };
  });

  if (focusVariantId) {
    const i = cells.findIndex((c) => c.variantId === focusVariantId);
    if (i > 0) {
      const [removed] = cells.splice(i, 1);
      cells.unshift(removed);
    }
  }

  return cells;
}

export function LabelSheetScreen(): JSX.Element | null {
  const { t } = useTranslation('label');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const profile = useProfile();

  const initialSheetMode = (searchParams.get('mode') as SheetMode) ?? 'all_variants';
  const focusVariantId = searchParams.get('focus') ?? null;

  const [sheetMode, setSheetMode] = useState<SheetMode>(initialSheetMode);
  const [contentMode, setContentMode] = useState<ContentMode>(
    (profile?.label_mode as ContentMode | null) ?? 'both',
  );
  const [layout, setLayout] = useState<LayoutMode>(
    (profile?.label_layout as LayoutMode | null) ?? 'sheet_3x4',
  );
  const [copies, setCopies] = useState(1);

  const data = useLive(async () => {
    if (!id) return null;
    const [article, sizes] = await Promise.all([getArticle(db, id), sizeGridFor(db, id)]);
    return article ? { article, sizes } : null;
  }, [id]);

  const cells = useMemo(() => {
    if (!data?.article || !profile) return [];
    const hasColors = articleHasColors(data.article, profile);
    const hasSizes = articleHasSizes(data.article, profile);
    return buildCells(data.article, data.sizes, sheetMode, hasColors, hasSizes, focusVariantId);
  }, [data, profile, sheetMode, focusVariantId]);

  const totalLabels = cells.length * copies;
  const totalSheets = Math.ceil(totalLabels / PER_SHEET[layout]);
  const highInk = contentMode === 'both';

  async function savePrefs(cm: ContentMode, ly: LayoutMode): Promise<void> {
    if (!profile) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      label_mode: cm,
      label_layout: ly,
    });
  }

  function handleContentMode(cm: ContentMode): void {
    setContentMode(cm);
    void savePrefs(cm, layout);
  }

  function handleLayout(ly: LayoutMode): void {
    setLayout(ly);
    void savePrefs(contentMode, ly);
  }

  if (data === undefined || profile === undefined) return null;
  if (!data) {
    return (
      <ScreenLayout hideNav hideFooter>
        <div className="text-ink-3 p-6 text-center text-sm">{t('not_found')}</div>
      </ScreenLayout>
    );
  }

  const { article } = data;
  const colsClass =
    layout === 'sheet_3x4' ? 'grid-cols-3' : layout === 'sheet_2x5' ? 'grid-cols-2' : 'grid-cols-4';

  return (
    <ScreenLayout hideNav hideFooter>
      {/* Controls — hidden when printing */}
      <header className="border-hair flex items-center gap-3 border-b bg-white px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => navigate(`/article/${id ?? ''}`, { replace: true })}
          className="text-ink-2 -ml-1 p-1"
        >
          <ChevronLeft aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
        <h1 className="font-display text-ink flex-1 truncate text-base font-semibold">
          {article.name}
        </h1>
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {/* Options panel */}
        <div className="print:hidden space-y-4 px-5 py-4">
          {/* Sheet mode */}
          <div>
            <p className="text-ink-2 mb-1.5 text-xs font-medium">{t('sheet_mode_label')}</p>
            <div className="border-hair flex rounded-xl border bg-white p-1">
              {(['all_variants', 'colors_only', 'article_only'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSheetMode(m)}
                  className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                    sheetMode === m ? 'bg-ink text-white' : 'text-ink-2'
                  }`}
                >
                  {t(`sheet_mode_${m}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Content mode */}
          <div>
            <p className="text-ink-2 mb-1.5 text-xs font-medium">{t('sheet_content_label')}</p>
            <div className="border-hair flex rounded-xl border bg-white p-1">
              {(['both', 'qr_only', 'barcode_only'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleContentMode(m)}
                  className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                    contentMode === m ? 'bg-ink text-white' : 'text-ink-2'
                  }`}
                >
                  {t(`label_mode_${m}`)}
                </button>
              ))}
            </div>
            <p className="text-ink-3 mt-1 text-[11px]">{t(`label_mode_${contentMode}_hint`)}</p>
          </div>

          {/* Layout */}
          <div>
            <p className="text-ink-2 mb-1.5 text-xs font-medium">{t('sheet_layout_label')}</p>
            <div className="border-hair flex rounded-xl border bg-white p-1">
              {(['sheet_3x4', 'sheet_2x5', 'sheet_4x6'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleLayout(m)}
                  className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                    layout === m ? 'bg-ink text-white' : 'text-ink-2'
                  }`}
                >
                  {t(`sheet_layout_${m.replace('sheet_', '')}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Copies */}
          <div className="flex items-center justify-between">
            <p className="text-ink-2 text-xs font-medium">{t('sheet_copies_label')}</p>
            <input
              type="number"
              min={1}
              max={12}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(12, Number(e.target.value))))}
              className="border-hair w-16 rounded-lg border bg-white px-2 py-1 text-center text-sm font-mono"
            />
          </div>

          {/* Summary */}
          <div className="border-hair flex items-center justify-between rounded-xl border bg-white px-4 py-3">
            <p className="text-ink-2 text-sm">
              {t('sheet_summary', { labels: totalLabels, sheets: totalSheets })}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                highInk ? 'bg-amber-50 text-amber-700' : 'bg-ok-soft text-ok'
              }`}
            >
              {highInk ? t('sheet_ink_high') : t('sheet_ink_low')}
            </span>
          </div>

          {/* Print button */}
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-accent inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white"
          >
            <Printer aria-hidden className="h-4 w-4" strokeWidth={2} />
            {t('sheet_print_button')}
          </button>
        </div>

        {/* Printable sheet */}
        <div
          data-testid="label-sheet-print-area"
          className={`grid ${colsClass} gap-2 p-4 print:gap-1 print:p-0`}
        >
          {Array.from({ length: copies })
            .flatMap(() => cells)
            .map((cell, i) => (
              <div
                key={`${cell.variantId ?? 'article'}-${i}`}
                className="flex flex-col items-center gap-1 break-inside-avoid rounded-lg border border-dashed border-ink-4/40 p-2 text-center"
              >
                <div className="font-display text-[10px] font-medium text-ink leading-tight">
                  {article.name}
                </div>
                {cell.variantLabel ? (
                  <div className="text-[9px] text-ink-3">{cell.variantLabel}</div>
                ) : null}
                <div className="flex items-center justify-center gap-1.5">
                  {contentMode !== 'barcode_only' ? (
                    <ArticleQR
                      articleId={article.id}
                      variantId={cell.variantId}
                      forceBlack
                      size={70}
                    />
                  ) : null}
                  {contentMode !== 'qr_only' ? (
                    <ArticleBarcode code={cell.code} forceBlack width={1.5} height={40} />
                  ) : null}
                </div>
                <div className="font-mono text-[9px] text-ink-3">{cell.code}</div>
              </div>
            ))}
        </div>
      </div>
    </ScreenLayout>
  );
}
