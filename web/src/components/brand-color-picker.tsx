import { useState } from 'react';
import type React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { RadialColorPicker } from './radial-color-picker';
import { parseHex } from '../theme/apply-theme';
import { getReadableTextColor, isWCAGReadable, normaliseHex } from '../utils/contrast';

interface BrandColourOption {
  key: string;
  hex: string;
}

// Merchant-friendly palette: common POS/retail brand colours first, then
// broader choices. The technical HEX input stays tucked under Advanced so
// non-technical users can safely pick a colour without learning colour codes.
const RECOMMENDED_BRAND_COLORS: readonly BrandColourOption[] = [
  { key: 'orange', hex: '#FF6B35' },
  { key: 'teal', hex: '#0D9488' },
  { key: 'navy', hex: '#1E3A8A' },
  { key: 'green', hex: '#16A34A' },
  { key: 'rose', hex: '#E11D48' },
  { key: 'gold', hex: '#D97706' },
];

const MORE_BRAND_COLORS: readonly BrandColourOption[] = [
  { key: 'coral', hex: '#F97316' },
  { key: 'cognac', hex: '#B8642C' },
  { key: 'pink', hex: '#F54A6A' },
  { key: 'burgundy', hex: '#9F1239' },
  { key: 'violet', hex: '#8B5CF6' },
  { key: 'indigo', hex: '#4F46E5' },
  { key: 'sky', hex: '#0EA5E9' },
  { key: 'turquoise', hex: '#06B6D4' },
  { key: 'emerald', hex: '#10B981' },
  { key: 'sage', hex: '#65A30D' },
  { key: 'olive', hex: '#A3A01E' },
  { key: 'yellow', hex: '#EAB308' },
  { key: 'slate', hex: '#334155' },
  { key: 'ink', hex: '#111827' },
  { key: 'purple', hex: '#7C3AED' },
  { key: 'magenta', hex: '#DB2777' },
  { key: 'cyan', hex: '#0891B2' },
  { key: 'forest', hex: '#15803D' },
];

export interface BrandColorPickerProps {
  brandPrimaryColor: string | null;
  logoDominantColor: string | null;
  onChange: (hex: string | null) => void;
}

export function BrandColorPicker({
  brandPrimaryColor,
  logoDominantColor,
  onChange,
}: BrandColorPickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  const currentHex = normaliseHex(brandPrimaryColor);
  const detectedHex = normaliseHex(logoDominantColor);
  const showDetected = detectedHex !== null && detectedHex !== currentHex;

  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const customValue = customDraft ?? currentHex ?? '';
  const customParsed = parseHex(customValue);
  const customInvalid = customValue.trim() !== '' && customParsed === null;
  const previewHex = currentHex ?? '#FF6B35';
  const previewTextColor = getReadableTextColor(previewHex);
  const usesDarkTextForContrast =
    previewTextColor === '#111827' && !isWCAGReadable(previewHex, '#FFFFFF');

  function applyCustom(): void {
    if (customParsed === null) return;
    onChange(normaliseHex(customValue));
    setCustomDraft(null);
  }

  return (
    <div className="space-y-3" data-testid="brand-color-picker">
      {showDetected ? (
        <div
          data-testid="brand-color-detected"
          className="border-accent/30 bg-accent-soft/40 flex items-center gap-2 rounded-xl border px-3 py-2"
        >
          <Sparkles size={14} className="text-accent shrink-0" aria-hidden />
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <span className="text-ink-2 truncate">{t('brand_color_detected')}</span>
            <ColorSwatch
              hex={detectedHex!}
              size={20}
              testId="brand-color-detected-swatch"
              aria-label={detectedHex!}
            />
            <span className="text-ink-3 font-mono text-[11px]">{detectedHex}</span>
          </div>
          <button
            type="button"
            data-testid="brand-color-apply-detected"
            onClick={() => onChange(detectedHex)}
            className="bg-accent text-paper rounded-md px-2.5 py-1 text-xs font-medium"
          >
            {t('brand_color_apply')}
          </button>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ColorSwatch hex={previewHex} size={30} testId="brand-color-current" />
          <div>
            <p className="text-ink text-xs font-medium">{t('brand_color_palette_title')}</p>
            <p className="text-ink-3 text-[11px]">{t('brand_color_palette_hint')}</p>
          </div>
        </div>
        {currentHex ? <span className="text-ink-3 font-mono text-[11px]">{currentHex}</span> : null}
      </div>

      <PaletteGroup
        title={t('brand_color_recommended')}
        colours={RECOMMENDED_BRAND_COLORS}
        selectedHex={currentHex}
        onChange={onChange}
      />

      <PaletteGroup
        title={t('brand_color_more')}
        colours={MORE_BRAND_COLORS}
        selectedHex={currentHex}
        onChange={onChange}
        compact
      />

      <BrandColorPreview hex={previewHex} textColor={previewTextColor} />

      {usesDarkTextForContrast ? (
        <p
          data-testid="brand-color-low-contrast-warning"
          className="text-warn bg-warn/10 border-warn/20 rounded-xl border px-3 py-2 text-[11px]"
        >
          {t('brand_color_low_contrast_warning')}
        </p>
      ) : null}

      <details className="group rounded-xl border border-dashed border-ink-4/50 bg-white/60 px-3 py-2">
        <summary className="text-ink-2 cursor-pointer select-none text-xs font-medium marker:text-ink-3">
          {t('brand_color_advanced')}
        </summary>
        <div className="mt-3 space-y-4">
          <RadialColorPicker selectedHex={currentHex} onChange={onChange} />

          <div className="space-y-1 border-t border-ink-4/20 pt-2">
            <label htmlFor="brand-color-custom" className="text-ink-2 block text-xs font-medium">
              {t('brand_color_custom')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="brand-color-custom"
                data-testid="brand-color-custom-input"
                type="text"
                value={customValue}
                placeholder={t('brand_color_custom_placeholder')}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={applyCustom}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyCustom();
                  }
                }}
                className="border-hair text-ink placeholder:text-ink-3 focus-visible:ring-accent/40 min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={customParsed === null}
                className="bg-accent rounded-xl px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('brand_color_apply')}
              </button>
            </div>
            {customInvalid ? (
              <p data-testid="brand-color-custom-invalid" className="text-bad text-[11px]">
                {t('brand_color_invalid_hex')}
              </p>
            ) : null}
          </div>
        </div>
      </details>
    </div>
  );
}

function PaletteGroup({
  title,
  colours,
  selectedHex,
  onChange,
  compact = false,
}: {
  title: string;
  colours: readonly BrandColourOption[];
  selectedHex: string | null;
  onChange: (hex: string | null) => void;
  compact?: boolean;
}): JSX.Element {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-2">
      <p className="text-ink-2 text-[11px] font-semibold uppercase tracking-[0.08em]">{title}</p>
      <div
        className="grid grid-cols-6 gap-2 sm:grid-cols-9"
        role="radiogroup"
        aria-label={title}
        data-testid={compact ? 'brand-color-more' : 'brand-color-recommended'}
      >
        {colours.map(({ key, hex }) => {
          const isActive = selectedHex === hex;
          const markerColor = getReadableTextColor(hex);
          return (
            <button
              key={key}
              type="button"
              role="radio"
              data-testid={`brand-color-preset-${key}`}
              aria-label={`${t('brand_color_title')} ${key}`}
              aria-checked={isActive}
              onClick={() => onChange(hex)}
              className={`relative w-full rounded-xl border-2 transition-all duration-200 active:scale-[0.96] ${
                compact ? 'h-9 sm:h-10' : 'h-10 sm:h-11'
              } ${
                isActive
                  ? 'border-ink ring-accent/30 ring-2 ring-offset-1'
                  : 'border-transparent hover:border-ink-4'
              }`}
              style={{ backgroundColor: hex }}
            >
              {isActive ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-[10px] ring-2 ring-white/70">
                  <span
                    className="h-2.5 w-2.5 rounded-full shadow"
                    style={{ backgroundColor: markerColor }}
                  />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BrandColorPreview({ hex, textColor }: { hex: string; textColor: string }): JSX.Element {
  const { t } = useTranslation('settings');
  const softAlpha = hexToRgba(hex, 0.12);
  return (
    <div
      data-testid="brand-color-preview"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-ink-4/40 bg-white/70 p-3"
    >
      <span className="text-ink-3 text-[11px]">{t('brand_color_preview_label')}</span>
      <span
        className="rounded-full px-2 py-1 text-[11px] font-medium"
        style={{ backgroundColor: softAlpha, color: hex }}
      >
        {t('brand_color_preview_pill')}
      </span>
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full"
        style={{ backgroundColor: hex, color: textColor }}
      >
        +
      </span>
      <span
        className="rounded-md px-3 py-1 text-[11px] font-medium"
        style={{ backgroundColor: hex, color: textColor }}
      >
        {t('brand_color_preview_button')}
      </span>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const parsed = parseHex(hex);
  if (parsed === null) return `rgba(0, 0, 0, ${alpha})`;
  return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${alpha})`;
}

function ColorSwatch({
  hex,
  size,
  testId,
  ...rest
}: {
  hex: string;
  size: number;
  testId?: string;
} & React.HTMLAttributes<HTMLSpanElement>): JSX.Element {
  return (
    <span
      data-testid={testId}
      className="inline-block rounded-full border border-ink-4/30 shrink-0"
      style={{ width: size, height: size, backgroundColor: hex }}
      {...rest}
    />
  );
}
