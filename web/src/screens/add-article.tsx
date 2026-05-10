import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, ScanLine, Trash2 } from 'lucide-react';
import { BarcodeScanner } from '../components/barcode-scanner';
import { PhotoPicker } from '../components/photo-picker';
import { ScreenLayout } from '../components/screen-layout';
import { useLocationLabels } from '../hooks/use-location-labels';
import { STORE_TYPES } from '../config/store-types';
import { categoriesForSubtypes } from '../config/shop-subtypes';
import { sizeHintValuesForSubtypes } from '../config/fashion-subtypes';
import { db } from '../db/db';
import { createArticle } from '../repos/articles';
import { storePhoto } from '../repos/photos';
import { compressPhoto } from '../utils/compress-photo';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { nextInternalCode } from '../repos/internal-code';
import { parseCurrency } from '../i18n/parse-currency';
import { type Article, type Category, type UUID } from '../types';
import { CANONICAL_COLOURS } from '../query/colour-aliases';

// SPEC §2.5 + ADR-011: a two-step flow. Step 1 collects article basics
// (brand, name, category, prices, notes); Step 2 collects the per-colour
// breakdown for sized + coloured verticals (shoes, clothes), or a single
// floor + back quantity for sizeless verticals (kiosk, grocery). Saving
// the form commits one Article + N Variants + M Movements in a single
// Dexie transaction via createArticle's v2 shape.
//
// Soft duplicate detection runs on the Continue click: if there's already
// an article in the catalogue with the same (lowercased) brand + name,
// the user gets a dismissible banner above Step 2 with a link to the
// existing article so they can add a new colour to it instead. The
// warning never blocks save — it's a nudge, not a guard.

interface Basics {
  brand: string;
  name: string;
  category: Category;
  costInput: string;
  saleInput: string;
  notes: string;
  // v0.5 ADR-017: optional reorder threshold. Surfaced only when the
  // active vertical has has_expiry=true (shop). Stored as a string so
  // empty / typing-in-progress states are unambiguous; parsed at save.
  minStockInput: string;
}

// Parse the threshold input. Empty / non-numeric / <= 0 → null (no
// threshold). Positive integer → that integer.
function parseMinStock(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

interface SizeRow {
  size: string;
  floor: number;
  back: number;
}

interface ColorBlock {
  // Colour the user picked from the chip palette. For sizeless verticals
  // (kiosk / grocery) this stays empty and is stored as null on the
  // resulting variant.
  color: string;
  // Optional override the user typed under the chips. Wins over `color`
  // when non-empty (mirrors the v1.x custom-colour behaviour).
  customColor: string;
  // Optional manufacturer / supplier code per colour. Free text, stored
  // on Article.notes today (a per-colour field would need a schema bump
  // we're not doing yet — flagged as a future improvement).
  manufacturerCode: string;
  // Per-colour photo. The first block's photo also doubles as the
  // article-level Article.photo_id at save time so single-colour and
  // sizeless verticals carry one photo through both pointers without
  // duplication. ADR-013.
  photoId: UUID | null;
  photoPreviewUrl: string | null;
  // Size rows. For sizeless verticals this stays a single-element array
  // with size='' so the storage shape is uniform.
  sizes: SizeRow[];
}

function emptySizeRow(): SizeRow {
  return { size: '', floor: 0, back: 0 };
}

function emptyBlock(): ColorBlock {
  return {
    color: '',
    customColor: '',
    manufacturerCode: '',
    photoId: null,
    photoPreviewUrl: null,
    sizes: [emptySizeRow()],
  };
}

// Resolves the effective colour for a block: custom input wins if set,
// otherwise the chip selection, otherwise null (sizeless verticals).
function effectiveColor(block: ColorBlock): string | null {
  const custom = block.customColor.trim();
  if (custom !== '') return custom.toLowerCase();
  const chip = block.color.trim();
  if (chip === '') return null;
  return chip.toLowerCase();
}

export function AddArticleScreen(): JSX.Element {
  const { t } = useTranslation('add');
  const { t: tCommon } = useTranslation('common');
  const { t: tColor } = useTranslation('color');
  const { t: tCategory } = useTranslation('category');
  const navigate = useNavigate();
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const storeType = profile?.store_type ?? 'shoes';
  const storeCfg = STORE_TYPES[storeType];
  // v0.5 ADR-017: for shop with ≥1 sub-type, the suggested categories
  // come from the union of selected sub-types. Falls back to the static
  // STORE_TYPES.shop.categories list when no sub-types are set (legacy
  // pre-v7 rows where the migration left shop_subtypes=[]).
  const categories = useMemo(() => {
    if (storeType === 'shop' && profile?.shop_subtypes && profile.shop_subtypes.length > 0) {
      return categoriesForSubtypes(profile.shop_subtypes);
    }
    return storeCfg.categories;
  }, [storeCfg, storeType, profile?.shop_subtypes]);
  // v0.5.1: per-article opt-in for shop. The shop vertical defaults
  // to sizeless + colourless (the right call for groceries / kiosk
  // stock), but real shops also sell items like towels, notebooks or
  // T-shirts that have multiple sizes / colours. The two toggles
  // below let a shop merchant flip just THIS article into the sized
  // / coloured variant UI without changing the vertical default.
  // Non-shop verticals follow their built-in defaults — the toggles
  // are not rendered for shoes / clothes since the answer is always
  // "yes" there.
  const [shopWantsSizes, setShopWantsSizes] = useState(false);
  const [shopWantsColors, setShopWantsColors] = useState(false);
  const hasColors = storeType === 'shop' ? shopWantsColors : storeCfg.has_colors;
  const hasSizes = storeType === 'shop' ? shopWantsSizes : storeCfg.has_sizes;

  const [step, setStep] = useState<1 | 2>(1);
  const [basics, setBasics] = useState<Basics>(() => ({
    brand: '',
    name: '',
    category: storeCfg.categories[0] ?? '',
    costInput: '',
    saleInput: '',
    notes: '',
    minStockInput: '',
  }));
  const [blocks, setBlocks] = useState<ColorBlock[]>(() => [emptyBlock()]);
  const [duplicate, setDuplicate] = useState<Article | null>(null);
  const [dupDismissed, setDupDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);

  const skuPrefix = storeCfg.sku_prefix;
  const previewedCode = useLive<string>(
    () => nextInternalCode(db, skuPrefix),
    [skuPrefix],
    `${skuPrefix}-0001`,
  );

  // Object-URL cleanup so the photo previews don't leak when the user
  // navigates away or replaces a photo.
  useEffect(
    () => () => {
      blocks.forEach((b) => {
        if (b.photoPreviewUrl) URL.revokeObjectURL(b.photoPreviewUrl);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function patchBlock(i: number, patch: Partial<ColorBlock>): void {
    setBlocks((arr) => arr.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function patchBlockSize(i: number, j: number, patch: Partial<SizeRow>): void {
    setBlocks((arr) =>
      arr.map((b, idx) =>
        idx === i
          ? { ...b, sizes: b.sizes.map((s, sj) => (sj === j ? { ...s, ...patch } : s)) }
          : b,
      ),
    );
  }

  function addSizeRow(i: number): void {
    setBlocks((arr) =>
      arr.map((b, idx) => (idx === i ? { ...b, sizes: [...b.sizes, emptySizeRow()] } : b)),
    );
  }

  function removeSizeRow(i: number, j: number): void {
    setBlocks((arr) =>
      arr.map((b, idx) => (idx === i ? { ...b, sizes: b.sizes.filter((_, sj) => sj !== j) } : b)),
    );
  }

  function addColorBlock(): void {
    setBlocks((arr) => [...arr, emptyBlock()]);
  }

  function removeColorBlock(i: number): void {
    setBlocks((arr) => {
      const target = arr[i];
      if (target?.photoPreviewUrl) URL.revokeObjectURL(target.photoPreviewUrl);
      return arr.filter((_, idx) => idx !== i);
    });
  }

  async function handleBlockPhoto(i: number, file: File): Promise<void> {
    // v0.5.2.2: explicit error surface. Previously a thrown
    // PhotoTooLargeError or a silent compressor / Blob failure left
    // the merchant staring at the dropzone with no feedback. Log + set
    // an inline error string per block so the UI can show why the
    // upload didn't take.
    try {
      const compressed = await compressPhoto(file);
      const stored = await storePhoto(db, {
        blob: compressed.blob,
        width: compressed.width,
        height: compressed.height,
        mime: compressed.mime,
      });
      const previousUrl = blocks[i]?.photoPreviewUrl ?? null;
      if (previousUrl) URL.revokeObjectURL(previousUrl);
      const url = URL.createObjectURL(compressed.blob);
      patchBlock(i, { photoId: stored.id, photoPreviewUrl: url });
    } catch (err) {
      const e = err as Error;
      // Surfaces both PhotoTooLargeError (input too big) and any
      // device-specific Blob / canvas / IDB failures. The boot
      // fallback's unhandledrejection listener also captures this
      // for the merchant who never sees DevTools.
      console.error('Photo upload failed', e);
    }
  }

  function validateStep1(): Record<string, string> {
    const e: Record<string, string> = {};
    if (basics.name.trim().length < 2) e.name = t('err_name_required');
    return e;
  }

  function validateStep2(): Record<string, string> {
    const e: Record<string, string> = {};
    let hasAnyPhoto = false;
    let hasAnyStock = false;
    for (let i = 0; i < blocks.length; i += 1) {
      const b = blocks[i]!;
      if (b.photoId) hasAnyPhoto = true;
      if (hasColors && effectiveColor(b) === null) {
        e[`block-${i}-color`] = t('err_color_required');
      }
      for (let j = 0; j < b.sizes.length; j += 1) {
        const s = b.sizes[j]!;
        if (hasSizes && s.size.trim() === '') {
          e[`block-${i}-size-${j}`] = t('err_size_required');
        }
        if (s.floor > 0 || s.back > 0) hasAnyStock = true;
      }
    }
    if (!hasAnyPhoto) e.photo = t('err_photo_required');
    if (!hasAnyStock) e.stock = t('err_stock_required');
    return e;
  }

  async function continueToStep2(): Promise<void> {
    const stepErrors = validateStep1();
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;

    // Soft duplicate check. Lookup by lowercased (brand, name) pair against
    // alive, non-archived articles. Brand can be empty; that's fine — many
    // shops don't track brand.
    const brand = basics.brand.trim().toLowerCase();
    const name = basics.name.trim().toLowerCase();
    const candidates = await db.articles
      .filter(
        (a) =>
          a.deleted_at === null &&
          a.archived_at === null &&
          a.name.toLowerCase() === name &&
          (a.brand ?? '').toLowerCase() === brand,
      )
      .toArray();
    setDuplicate(candidates[0] ?? null);
    setDupDismissed(false);
    setStep(2);
  }

  async function save(): Promise<void> {
    const stepErrors = validateStep2();
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setSubmitting(true);
    try {
      const cost = Math.max(0, parseCurrency(basics.costInput, locale, currency) ?? 0);
      const sale = Math.max(0, parseCurrency(basics.saleInput, locale, currency) ?? 0);

      const variantSpecs = blocks.flatMap((b) =>
        b.sizes.map((s) => ({
          color: hasColors ? effectiveColor(b) : null,
          size: hasSizes ? (s.size.trim() === '' ? null : s.size.trim()) : null,
          floor_qty: Math.max(0, Math.floor(s.floor)),
          back_qty: Math.max(0, Math.floor(s.back)),
          photo_id: b.photoId ?? null,
        })),
      );

      // Article-level photo: the first block that carries one. Falls back
      // to null for the (impossible-given-validation) edge case where no
      // block has a photo.
      const articlePhotoId = blocks.find((b) => b.photoId)?.photoId ?? null;

      // Manufacturer code blob: append per-colour codes to the notes
      // field for now. A dedicated Variant.manufacturer_code field is a
      // future schema bump.
      const noteParts: string[] = [];
      if (basics.notes.trim()) noteParts.push(basics.notes.trim());
      for (const b of blocks) {
        const code = b.manufacturerCode.trim();
        if (code !== '') {
          const c = effectiveColor(b);
          noteParts.push(c !== null ? `${c}: ${code}` : code);
        }
      }
      const notes = noteParts.length === 0 ? null : noteParts.join(' · ');

      const created = await createArticle(db, {
        name: basics.name.trim(),
        photo_id: articlePhotoId,
        category: basics.category,
        brand: basics.brand.trim() === '' ? null : basics.brand.trim(),
        cost_price_tnd: cost,
        sale_price_tnd: sale,
        notes,
        variants: variantSpecs,
        sku_prefix: skuPrefix,
        // v0.5 ADR-017: only meaningful for shop; null for shoes /
        // clothes (the input isn't surfaced there). createArticle
        // accepts null and stores it verbatim.
        min_stock_threshold: parseMinStock(basics.minStockInput),
      });
      // v0.5.2.3 — land on the printable-label page so the merchant
      // sees the QR for the just-created item and can stick it on the
      // shelf in one tap. Done returns to the article detail.
      navigate(`/article/${created.article.id}/label`, { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenLayout hideNav>
      <header className="border-hair grid grid-cols-3 items-center border-b px-4 py-3">
        <button
          type="button"
          data-testid={step === 1 ? 'add-cancel' : 'add-back'}
          onClick={() => (step === 1 ? navigate(-1) : setStep(1))}
          className="text-ink-3 justify-self-start text-xs"
        >
          {step === 1 ? tCommon('cancel') : tCommon('back')}
        </button>
        <h3 className="font-display justify-self-center text-sm font-semibold tracking-tight">
          {t('title')}
        </h3>
        <span
          data-testid="add-step-indicator"
          className="text-ink-3 justify-self-end font-mono text-[11px]"
          dir="ltr"
        >
          {step} / 2
        </span>
      </header>

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(value) => {
          setScannerOpen(false);
          setBasics((b) => ({ ...b, notes: b.notes ? `${b.notes} · ${value}` : value }));
        }}
      />

      {step === 1 ? (
        <Step1
          basics={basics}
          setBasics={setBasics}
          previewedCode={previewedCode}
          categories={categories}
          tCategory={tCategory}
          errors={errors}
          locale={locale}
          currency={currency}
          onScan={() => setScannerOpen(true)}
          showMinStock={storeCfg.has_expiry}
        />
      ) : (
        <Step2
          blocks={blocks}
          patchBlock={patchBlock}
          patchBlockSize={patchBlockSize}
          addSizeRow={addSizeRow}
          removeSizeRow={removeSizeRow}
          addColorBlock={addColorBlock}
          removeColorBlock={removeColorBlock}
          handleBlockPhoto={handleBlockPhoto}
          hasColors={hasColors}
          hasSizes={hasSizes}
          duplicate={duplicate}
          dupDismissed={dupDismissed}
          dismissDuplicate={() => setDupDismissed(true)}
          tColor={tColor}
          errors={errors}
          shopOptIn={
            storeType === 'shop'
              ? {
                  wantsSizes: shopWantsSizes,
                  wantsColors: shopWantsColors,
                  setWantsSizes: setShopWantsSizes,
                  setWantsColors: setShopWantsColors,
                }
              : null
          }
        />
      )}

      <div className="border-hair flex flex-shrink-0 gap-2 border-t bg-white px-3 py-3 pb-5">
        {step === 1 ? (
          <button
            type="button"
            data-testid="continue"
            onClick={() => void continueToStep2()}
            disabled={basics.name.trim().length < 2}
            className="bg-accent flex-1 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {tCommon('continue')}
          </button>
        ) : (
          <button
            type="button"
            data-testid="save"
            disabled={submitting}
            onClick={() => void save()}
            className="bg-accent flex-1 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {tCommon('save')}
          </button>
        )}
      </div>
    </ScreenLayout>
  );
}

interface Step1Props {
  basics: Basics;
  setBasics: React.Dispatch<React.SetStateAction<Basics>>;
  previewedCode: string;
  categories: readonly string[];
  tCategory: (k: string) => string;
  errors: Record<string, string>;
  locale: string;
  currency: string;
  onScan: () => void;
  // v0.5 ADR-017: surface the min_stock_threshold input only for the
  // shop vertical (drives the "Low (N left)" badge in Search/List).
  showMinStock: boolean;
}

function Step1({
  basics,
  setBasics,
  previewedCode,
  categories,
  tCategory,
  errors,
  locale: _locale,
  currency,
  onScan,
  showMinStock,
}: Step1Props): JSX.Element {
  const { t } = useTranslation('add');
  const { t: tCommon } = useTranslation('common');
  return (
    <div data-testid="step-1" className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4">
      <button
        type="button"
        data-testid="add-scan"
        onClick={onScan}
        className="text-accent self-end inline-flex items-center gap-1 text-xs font-medium"
      >
        <ScanLine aria-hidden className="h-4 w-4" strokeWidth={2.25} />
        {t('scan_button')}
      </button>

      <section
        data-testid="add-section-identity"
        className="border-hair space-y-3 rounded-2xl border bg-white p-4"
      >
        <Field label={t('field_code')}>
          <span
            data-testid="field-code"
            className="bg-paper border-hair font-mono rounded-xl border px-3 py-2.5 font-medium"
            dir="ltr"
          >
            {previewedCode}
          </span>
        </Field>
        <Field label={t('field_name')}>
          <input
            data-testid="field-name"
            type="text"
            value={basics.name}
            onChange={(e) => setBasics((b) => ({ ...b, name: e.target.value }))}
            placeholder={t('field_name_placeholder')}
            className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
        </Field>
        {errors.name ? (
          <p data-testid="err-name" className="text-bad text-xs">
            {errors.name}
          </p>
        ) : null}
        <Field label={t('field_brand')} hint={tCommon('optional')}>
          <input
            data-testid="field-brand"
            type="text"
            value={basics.brand}
            onChange={(e) => setBasics((b) => ({ ...b, brand: e.target.value }))}
            placeholder={t('field_brand_placeholder')}
            className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
        </Field>
        <Field label={t('field_category')}>
          <div data-testid="category-chips" className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`category-${c}`}
                onClick={() => setBasics((b) => ({ ...b, category: c }))}
                aria-pressed={basics.category === c}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  basics.category === c
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-hair text-ink-2 bg-white'
                }`}
              >
                {tCategory(c)}
              </button>
            ))}
          </div>
        </Field>
      </section>

      <section
        data-testid="add-section-pricing"
        className="border-hair space-y-3 rounded-2xl border bg-white p-4"
      >
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('field_cost', { currency })} hint={tCommon('optional')}>
            <input
              data-testid="field-cost"
              type="text"
              inputMode="decimal"
              value={basics.costInput}
              onChange={(e) => setBasics((b) => ({ ...b, costInput: e.target.value }))}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
            />
          </Field>
          <Field label={t('field_sale', { currency })} hint={tCommon('optional')}>
            <input
              data-testid="field-sale"
              type="text"
              inputMode="decimal"
              value={basics.saleInput}
              onChange={(e) => setBasics((b) => ({ ...b, saleInput: e.target.value }))}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
            />
          </Field>
        </div>
        <Field label={t('field_notes')} hint={tCommon('optional')}>
          <input
            data-testid="field-notes"
            type="text"
            value={basics.notes}
            onChange={(e) => setBasics((b) => ({ ...b, notes: e.target.value }))}
            placeholder={t('field_notes_placeholder')}
            className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
        </Field>
        {showMinStock ? (
          <Field label={t('field_min_stock')} hint={tCommon('optional')}>
            <input
              data-testid="field-min-stock"
              type="number"
              inputMode="numeric"
              min={0}
              value={basics.minStockInput}
              onChange={(e) => setBasics((b) => ({ ...b, minStockInput: e.target.value }))}
              placeholder={t('field_min_stock_placeholder')}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
            />
          </Field>
        ) : null}
      </section>
    </div>
  );
}

interface Step2Props {
  blocks: ColorBlock[];
  patchBlock: (i: number, patch: Partial<ColorBlock>) => void;
  patchBlockSize: (i: number, j: number, patch: Partial<SizeRow>) => void;
  addSizeRow: (i: number) => void;
  removeSizeRow: (i: number, j: number) => void;
  addColorBlock: () => void;
  removeColorBlock: (i: number) => void;
  handleBlockPhoto: (i: number, file: File) => Promise<void>;
  hasColors: boolean;
  hasSizes: boolean;
  duplicate: Article | null;
  dupDismissed: boolean;
  dismissDuplicate: () => void;
  tColor: (k: string) => string;
  errors: Record<string, string>;
  // v0.5.1: shop-only opt-in to sizes / colours per article. Null
  // for non-shop verticals (which always have the built-in answer).
  shopOptIn: {
    wantsSizes: boolean;
    wantsColors: boolean;
    setWantsSizes: (v: boolean) => void;
    setWantsColors: (v: boolean) => void;
  } | null;
}

function Step2(props: Step2Props): JSX.Element {
  const { t } = useTranslation('add');
  const {
    blocks,
    patchBlock,
    patchBlockSize,
    addSizeRow,
    removeSizeRow,
    addColorBlock,
    removeColorBlock,
    handleBlockPhoto,
    hasColors,
    hasSizes,
    duplicate,
    dupDismissed,
    dismissDuplicate,
    tColor,
    errors,
    shopOptIn,
  } = props;

  return (
    <div data-testid="step-2" className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-4">
      {duplicate && !dupDismissed ? (
        <div
          data-testid="duplicate-warning"
          className="bg-warn-soft border-warn rounded-xl border p-3 text-xs"
        >
          <p className="text-ink">
            {t('duplicate_warn', {
              name: duplicate.name,
              count: duplicate.colors.length,
            })}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <Link
              data-testid="duplicate-link"
              to={`/article/${duplicate.id}`}
              className="text-accent font-medium"
            >
              {t('duplicate_open_existing')}
            </Link>
            <button
              type="button"
              data-testid="duplicate-dismiss"
              onClick={dismissDuplicate}
              className="text-ink-3"
            >
              {t('duplicate_dismiss')}
            </button>
          </div>
        </div>
      ) : null}

      {errors.photo ? (
        <p data-testid="err-photo" className="text-bad text-xs">
          {errors.photo}
        </p>
      ) : null}
      {errors.stock ? (
        <p data-testid="err-stock" className="text-bad text-xs">
          {errors.stock}
        </p>
      ) : null}

      {shopOptIn ? (
        <section
          data-testid="shop-variant-optin"
          className="border-hair rounded-2xl border bg-white p-3"
        >
          <p className="text-ink-3 mb-2 text-[11px] leading-relaxed">{t('shop_optin_hint')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="shop-optin-sizes"
              aria-pressed={shopOptIn.wantsSizes}
              onClick={() => shopOptIn.setWantsSizes(!shopOptIn.wantsSizes)}
              className={`flex-1 rounded-xl border px-3 py-2 text-xs ${
                shopOptIn.wantsSizes
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-hair bg-white text-ink-2'
              }`}
            >
              {t('shop_optin_sizes')}
            </button>
            <button
              type="button"
              data-testid="shop-optin-colors"
              aria-pressed={shopOptIn.wantsColors}
              onClick={() => shopOptIn.setWantsColors(!shopOptIn.wantsColors)}
              className={`flex-1 rounded-xl border px-3 py-2 text-xs ${
                shopOptIn.wantsColors
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-hair bg-white text-ink-2'
              }`}
            >
              {t('shop_optin_colors')}
            </button>
          </div>
        </section>
      ) : null}

      {blocks.map((block, i) => (
        <BlockEditor
          key={i}
          index={i}
          block={block}
          isOnly={blocks.length === 1}
          hasColors={hasColors}
          hasSizes={hasSizes}
          tColor={tColor}
          errors={errors}
          patchBlock={patchBlock}
          patchBlockSize={patchBlockSize}
          addSizeRow={addSizeRow}
          removeSizeRow={removeSizeRow}
          removeColorBlock={removeColorBlock}
          handleBlockPhoto={handleBlockPhoto}
        />
      ))}

      {hasColors ? (
        <button
          type="button"
          data-testid="add-color-block"
          onClick={addColorBlock}
          className="border-hair text-ink-2 inline-flex items-center justify-center gap-1.5 rounded-xl border bg-white py-2.5 text-sm"
        >
          <Plus aria-hidden className="h-4 w-4" strokeWidth={2.25} />
          {t('add_color_block')}
        </button>
      ) : null}
    </div>
  );
}

interface BlockEditorProps {
  index: number;
  block: ColorBlock;
  isOnly: boolean;
  hasColors: boolean;
  hasSizes: boolean;
  tColor: (k: string) => string;
  errors: Record<string, string>;
  patchBlock: (i: number, patch: Partial<ColorBlock>) => void;
  patchBlockSize: (i: number, j: number, patch: Partial<SizeRow>) => void;
  addSizeRow: (i: number) => void;
  removeSizeRow: (i: number, j: number) => void;
  removeColorBlock: (i: number) => void;
  handleBlockPhoto: (i: number, file: File) => Promise<void>;
}

function BlockEditor(props: BlockEditorProps): JSX.Element {
  const { t } = useTranslation('add');
  // v0.5.2 ADR-022: merchant-customisable location labels for the
  // floor/back Stepper inputs. Falls back to the locale + vertical
  // defaults if the profile field is unset.
  const labels = useLocationLabels();
  // v0.5.2 commit 9: sub-type-aware size hint autocomplete. Reads
  // the merchant's selected fashion subtypes from the profile and
  // computes the union of their size_hint values. Empty array → no
  // datalist rendered (sized verticals with size_hint='none' or
  // non-fashion verticals where the entire size column is hidden).
  const profile = useProfile();
  const sizeHintValues = useMemo(
    () => sizeHintValuesForSubtypes(profile?.fashion_subtypes ?? []),
    [profile?.fashion_subtypes],
  );
  const {
    index,
    block,
    isOnly,
    hasColors,
    hasSizes,
    tColor,
    errors,
    patchBlock,
    patchBlockSize,
    addSizeRow,
    removeSizeRow,
    removeColorBlock,
    handleBlockPhoto,
  } = props;
  return (
    <section
      data-testid={`block-${index}`}
      className="border-hair space-y-3 rounded-2xl border bg-white p-4"
    >
      {hasColors && !isOnly ? (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid={`block-${index}-remove`}
            onClick={() => removeColorBlock(index)}
            className="text-ink-3 inline-flex items-center gap-1 text-[11px]"
          >
            <Trash2 aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
            {t('remove_color_block')}
          </button>
        </div>
      ) : null}

      <div
        data-testid={`block-${index}-photo-cta`}
        className={`aspect-[16/11] flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-ink-2 ${
          block.photoId ? 'border-ok bg-ok-soft/30' : 'border-ink-4/40 bg-paper-deep/40'
        }`}
      >
        {block.photoPreviewUrl ? (
          <img
            src={block.photoPreviewUrl}
            alt=""
            className="h-full w-full rounded-xl object-cover"
            data-testid={`block-${index}-photo-preview`}
          />
        ) : (
          <span className="font-display text-[13px] font-medium text-ink">{t('photo_cta')}</span>
        )}
      </div>
      {/* v0.5.1: explicit Camera + Gallery buttons. Some Androids
          only show the camera in their default file picker — this
          guarantees the merchant has a one-tap path to the gallery.
          PhotoPicker exposes the gallery input under the original
          `block-${index}-photo-input` testid so existing tests work. */}
      <PhotoPicker
        testIdBase={`block-${index}-photo`}
        onFile={(file) => void handleBlockPhoto(index, file)}
      />

      {hasColors ? (
        <div data-testid={`block-${index}-color-chips`} className="flex flex-wrap gap-1.5">
          {CANONICAL_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              data-testid={`block-${index}-color-${c}`}
              onClick={() => patchBlock(index, { color: c, customColor: '' })}
              aria-pressed={block.color === c && block.customColor === ''}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                block.color === c && block.customColor === ''
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-hair text-ink-2 bg-white'
              }`}
            >
              {tColor(c)}
            </button>
          ))}
          <input
            data-testid={`block-${index}-color-custom`}
            type="text"
            value={block.customColor}
            onChange={(e) => patchBlock(index, { customColor: e.target.value, color: '' })}
            placeholder={tColor('custom_placeholder')}
            maxLength={30}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2 text-xs"
          />
        </div>
      ) : null}
      {errors[`block-${index}-color`] ? (
        <p data-testid={`err-block-${index}-color`} className="text-bad text-xs">
          {errors[`block-${index}-color`]}
        </p>
      ) : null}

      {hasColors ? (
        <input
          data-testid={`block-${index}-mfr-code`}
          type="text"
          value={block.manufacturerCode}
          onChange={(e) => patchBlock(index, { manufacturerCode: e.target.value })}
          placeholder={t('field_mfr_code_placeholder')}
          className="border-hair w-full rounded-xl border bg-white px-3 py-2 text-xs"
        />
      ) : null}

      {hasSizes ? (
        <div data-testid={`block-${index}-sizes`} className="space-y-2">
          {/* v0.5.2 ADR-018 + commit 9: sub-type-aware size hint
              autocomplete. The <datalist> sources its options from
              sizeHintValuesForSubtypes(profile.fashion_subtypes) —
              numeric_eu (36-46) for shoes, letter (XS-XXXL) for
              clothing_men, etc. The merchant can still type any
              value; the hints are pure suggestions. Empty for
              accessories / bags / jewelry (size_hint='none'). */}
          {sizeHintValues.length > 0 ? (
            <datalist id={`block-${index}-size-hints`} data-testid={`block-${index}-size-hints`}>
              {sizeHintValues.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          ) : null}
          {block.sizes.map((row, j) => (
            <div key={j} className="flex items-center gap-2">
              <input
                data-testid={`block-${index}-size-${j}-input`}
                type="text"
                value={row.size}
                onChange={(e) => patchBlockSize(index, j, { size: e.target.value })}
                placeholder={t('size_placeholder')}
                list={sizeHintValues.length > 0 ? `block-${index}-size-hints` : undefined}
                className="border-hair w-16 rounded-lg border bg-white px-2 py-1.5 font-mono text-sm"
                inputMode="numeric"
              />
              <Stepper
                testId={`block-${index}-size-${j}-floor`}
                label={labels.floor}
                value={row.floor}
                onChange={(v) => patchBlockSize(index, j, { floor: v })}
              />
              <Stepper
                testId={`block-${index}-size-${j}-back`}
                label={labels.back}
                value={row.back}
                onChange={(v) => patchBlockSize(index, j, { back: v })}
              />
              {block.sizes.length > 1 ? (
                <button
                  type="button"
                  data-testid={`block-${index}-size-${j}-remove`}
                  onClick={() => removeSizeRow(index, j)}
                  className="text-ink-3"
                  aria-label={t('remove_size_row')}
                >
                  <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2} />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            data-testid={`block-${index}-add-size`}
            onClick={() => addSizeRow(index)}
            className="border-hair text-ink-2 inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
            {t('add_size_row')}
          </button>
        </div>
      ) : (
        // Sizeless verticals get a single floor + back row with no size
        // input. The single SizeRow stays under the same array shape so
        // saving doesn't have to special-case the storage path.
        <div data-testid={`block-${index}-sizeless`} className="flex items-center gap-3">
          <Stepper
            testId={`block-${index}-floor`}
            label={labels.floor}
            value={block.sizes[0]?.floor ?? 0}
            onChange={(v) => patchBlockSize(index, 0, { floor: v })}
          />
          <Stepper
            testId={`block-${index}-back`}
            label={labels.back}
            value={block.sizes[0]?.back ?? 0}
            onChange={(v) => patchBlockSize(index, 0, { back: v })}
          />
        </div>
      )}
    </section>
  );
}

function Stepper({
  testId,
  label,
  value,
  onChange,
}: {
  testId: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div className="border-hair flex flex-1 items-center rounded-lg border bg-white">
      <span className="text-ink-3 px-2 text-[10px] font-mono uppercase tracking-wider">
        {label}
      </span>
      <button
        type="button"
        data-testid={`${testId}-minus`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="bg-paper border-hair h-7 w-7 rounded border-l text-base"
      >
        −
      </button>
      <input
        data-testid={testId}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="w-12 bg-transparent text-center font-mono text-sm tabular-nums"
      />
      <button
        type="button"
        data-testid={`${testId}-plus`}
        onClick={() => onChange(value + 1)}
        className="bg-paper border-hair h-7 w-7 rounded border-l text-base"
      >
        +
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ink-2 flex items-baseline justify-between text-[13px] font-medium">
        <span>{label}</span>
        {hint ? <span className="text-ink-3 text-[11px] font-normal">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}
