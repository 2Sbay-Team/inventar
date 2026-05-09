import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { createArticle } from '../repos/articles';
import { storePhoto } from '../repos/photos';
import { compressPhoto } from '../utils/compress-photo';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { useLive } from '../hooks/use-live';
import { nextInternalCode } from '../repos/internal-code';
import { parseCurrency } from '../i18n/parse-currency';
import { type Category, type UUID } from '../types';
import { CANONICAL_COLOURS } from '../query/colour-aliases';

const CATEGORIES: ReadonlyArray<Category> = ['sport', 'dress', 'casual', 'kids', 'women', 'men'];

interface FormState {
  photoId: UUID | null;
  photoPreviewUrl: string | null;
  name: string;
  color: string;
  brand: string;
  category: Category;
  sizes: string;
  qty: number;
  costInput: string;
  saleInput: string;
}

const INITIAL: FormState = {
  photoId: null,
  photoPreviewUrl: null,
  name: '',
  color: '',
  brand: '',
  category: 'sport',
  sizes: '',
  qty: 1,
  costInput: '',
  saleInput: '',
};

export function AddArticleScreen(): JSX.Element {
  const { t } = useTranslation('add');
  const { t: tCommon } = useTranslation('common');
  const { t: tColor } = useTranslation('color');
  const { t: tCategory } = useTranslation('category');
  const navigate = useNavigate();
  const { locale } = useLocale();
  const currency = useCurrency();

  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewedCode = useLive<string>(() => nextInternalCode(db), [], 'SH-0001');

  function patch(patch: Partial<FormState>): void {
    setForm((s) => ({ ...s, ...patch }));
  }

  useEffect(
    () => () => {
      if (form.photoPreviewUrl) URL.revokeObjectURL(form.photoPreviewUrl);
    },
    [form.photoPreviewUrl],
  );

  async function handlePhoto(file: File): Promise<void> {
    const compressed = await compressPhoto(file);
    const stored = await storePhoto(db, {
      blob: compressed.blob,
      width: compressed.width,
      height: compressed.height,
      mime: compressed.mime,
    });
    if (form.photoPreviewUrl) URL.revokeObjectURL(form.photoPreviewUrl);
    const url = URL.createObjectURL(compressed.blob);
    patch({ photoId: stored.id, photoPreviewUrl: url });
  }

  function parseSizes(input: string): string[] {
    return input
      .split(/[,\s]+/u)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.photoId) e.photo = t('err_photo_required');
    if (form.name.trim().length < 2) e.name = t('err_name_required');
    const parsed = parseSizes(form.sizes);
    if (parsed.length === 0) e.sizes = t('err_invalid_sizes');
    if (!parsed.every((s) => /^[A-Za-z0-9]+$/.test(s))) e.sizes = t('err_invalid_sizes');
    return e;
  }

  async function save(addAnother: boolean): Promise<void> {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setSubmitting(true);
    const cost = Math.max(0, parseCurrency(form.costInput, locale, currency) ?? 0);
    const sale = Math.max(0, parseCurrency(form.saleInput, locale, currency) ?? 0);
    const sizes = parseSizes(form.sizes).map((size) => ({ size, initial_qty: form.qty }));
    await createArticle(db, {
      name: form.name.trim(),
      photo_id: form.photoId,
      category: form.category,
      colors: form.color ? [form.color] : [],
      brand: form.brand.trim() === '' ? null : form.brand.trim(),
      cost_price_tnd: cost,
      sale_price_tnd: sale,
      notes: null,
      sizes,
    });
    setSubmitting(false);
    if (addAnother) {
      // Keep colour/brand/category as defaults; reset photo + name + sizes.
      setForm((s) => ({
        ...INITIAL,
        color: s.color,
        brand: s.brand,
        category: s.category,
      }));
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors({});
    } else {
      navigate('/', { replace: true });
    }
  }

  const canSave = form.photoId !== null && form.name.trim().length >= 2 && !submitting;

  return (
    <ScreenLayout hideNav>
      <header className="border-hair grid grid-cols-3 items-center border-b px-4 py-3">
        <button
          type="button"
          data-testid="add-cancel"
          onClick={() => navigate(-1)}
          className="text-ink-3 justify-self-start text-xs"
        >
          {tCommon('cancel')}
        </button>
        <h3 className="font-display justify-self-center text-sm font-semibold tracking-tight">
          {t('title')}
        </h3>
        <span aria-hidden className="justify-self-end" />
      </header>

      <label
        data-testid="photo-cta"
        htmlFor="add-photo-input"
        className={`mx-4 mt-4 aspect-[16/11] flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-ink-2 ${form.photoId ? 'border-ok bg-ok-soft/30' : 'border-ink-4/40 bg-paper-deep/40'}`}
      >
        {form.photoPreviewUrl ? (
          <img
            src={form.photoPreviewUrl}
            alt=""
            className="h-full w-full rounded-2xl object-cover"
            data-testid="photo-preview"
          />
        ) : (
          <>
            <svg
              data-testid="photo-cta-icon"
              aria-hidden="true"
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-2"
            >
              <rect x="3" y="6" width="18" height="14" rx="2" />
              <circle cx="12" cy="13" r="3" />
              <path d="M8 6l1-2h6l1 2" />
            </svg>
            <span className="font-display text-[13px] font-medium text-ink">{t('photo_cta')}</span>
            <span className="text-accent font-mono text-[9.5px] uppercase tracking-widest">
              {t('photo_required')}
            </span>
          </>
        )}
      </label>
      <input
        ref={fileInputRef}
        id="add-photo-input"
        data-testid="photo-input"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handlePhoto(file);
        }}
      />
      {errors.photo ? <p className="text-bad px-5 text-xs">{errors.photo}</p> : null}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4">
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
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={t('field_name_placeholder')}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
            />
          </Field>
          {errors.name ? (
            <p data-testid="err-name" className="text-bad text-xs">
              {errors.name}
            </p>
          ) : null}
        </section>

        <section
          data-testid="add-section-description"
          className="border-hair space-y-3 rounded-2xl border bg-white p-4"
        >
          <Field label={t('field_color')}>
            <div data-testid="color-chips" className="flex flex-wrap gap-1.5">
              {CANONICAL_COLOURS.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`color-${c}`}
                  onClick={() => patch({ color: c })}
                  aria-pressed={form.color === c}
                  className={`rounded-full border px-3 py-1.5 text-xs ${form.color === c ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair text-ink-2 bg-white'}`}
                >
                  {tColor(c)}
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('field_brand')}>
            <input
              data-testid="field-brand"
              type="text"
              value={form.brand}
              onChange={(e) => patch({ brand: e.target.value })}
              placeholder={t('field_brand_placeholder')}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
            />
          </Field>

          <Field label={t('field_category')}>
            <div data-testid="category-chips" className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  data-testid={`category-${c}`}
                  onClick={() => patch({ category: c })}
                  aria-pressed={form.category === c}
                  className={`rounded-full border px-3 py-1.5 text-xs ${form.category === c ? 'border-accent bg-accent-soft text-accent-ink' : 'border-hair text-ink-2 bg-white'}`}
                >
                  {tCategory(c)}
                </button>
              ))}
            </div>
          </Field>
        </section>

        <section
          data-testid="add-section-stock"
          className="border-hair space-y-3 rounded-2xl border bg-white p-4"
        >
          <Field label={t('field_sizes')}>
            <input
              data-testid="field-sizes"
              type="text"
              value={form.sizes}
              onChange={(e) => patch({ sizes: e.target.value })}
              placeholder={t('field_sizes_placeholder')}
              className="border-hair rounded-xl border bg-white px-3 py-2.5 text-sm"
              inputMode="numeric"
            />
          </Field>
          {errors.sizes ? (
            <p data-testid="err-sizes" className="text-bad text-xs">
              {errors.sizes}
            </p>
          ) : null}

          <Field label={t('field_qty')}>
            <div className="border-hair flex items-center rounded-xl border bg-white p-1.5">
              <button
                type="button"
                data-testid="qty-minus"
                onClick={() => patch({ qty: Math.max(0, form.qty - 1) })}
                className="bg-paper border-hair h-8 w-8 rounded-lg border"
              >
                −
              </button>
              <span data-testid="qty-value" className="flex-1 text-center font-mono tabular-nums">
                {form.qty}
              </span>
              <button
                type="button"
                data-testid="qty-plus"
                onClick={() => patch({ qty: form.qty + 1 })}
                className="bg-paper border-hair h-8 w-8 rounded-lg border"
              >
                +
              </button>
            </div>
          </Field>
        </section>

        <section
          data-testid="add-section-pricing"
          className="border-hair space-y-3 rounded-2xl border bg-white p-4"
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('field_cost', { currency })} hint={t('optional')}>
              <input
                data-testid="field-cost"
                type="text"
                inputMode="decimal"
                value={form.costInput}
                onChange={(e) => patch({ costInput: e.target.value })}
                className="border-hair rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
              />
            </Field>
            <Field label={t('field_sale', { currency })} hint={t('optional')}>
              <input
                data-testid="field-sale"
                type="text"
                inputMode="decimal"
                value={form.saleInput}
                onChange={(e) => patch({ saleInput: e.target.value })}
                className="border-hair rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
              />
            </Field>
          </div>
          {errors.cost ? (
            <p data-testid="err-cost" className="text-bad text-xs">
              {errors.cost}
            </p>
          ) : null}
          {errors.sale ? (
            <p data-testid="err-sale" className="text-bad text-xs">
              {errors.sale}
            </p>
          ) : null}
        </section>
      </div>

      <div className="border-hair flex flex-shrink-0 gap-2 border-t bg-white px-3 py-3 pb-5">
        <button
          type="button"
          data-testid="save-and-add"
          disabled={!canSave}
          onClick={() => void save(true)}
          className="border-hair flex-1 rounded-xl border bg-white py-3 text-sm font-medium disabled:opacity-50"
        >
          {t('save_and_add')}
        </button>
        <button
          type="button"
          data-testid="save"
          disabled={!canSave}
          onClick={() => void save(false)}
          className="bg-accent flex-1 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {tCommon('save')}
        </button>
      </div>
    </ScreenLayout>
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
