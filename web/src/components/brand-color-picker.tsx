import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { parseHex } from '../theme/apply-theme';

// v0.9 ADR-040 / ADR-042 — Brand colour picker. Lives inside the Shop
// Identity section. Three pieces of UI:
//
//   1. A current-colour swatch + 12 preset swatches the merchant
//      can tap. Picking a preset writes the hex straight to
//      brand_primary_color via the autosave pipeline; Phase 2's
//      applyTheme hook propagates the change to the whole app
//      within one frame.
//   2. A custom-hex input that accepts #RGB / #RRGGBB. Invalid
//      input shows a small "Invalid hex" hint; the value isn't
//      written until it parses.
//   3. A "✨ Brand colour detected" prompt that shows when the
//      Phase 3 extractor stored a logo_dominant_color that
//      differs from the current brand_primary_color. Tapping
//      "Apply" writes the detected hex; "Keep current" leaves
//      it alone (the prompt re-appears on reload until the
//      merchant explicitly picks something).
//
// Preset palette: a curated 12-colour grid covering the merchant
// styles we see in the wild. Orange is the current Inventar
// default; the rest are professional tones that read well as an
// accent against the cream background and don't clash with the
// flat-design icon set.

const PRESET_BRAND_COLORS: ReadonlyArray<{ key: string; hex: string }> = [
  { key: 'orange', hex: '#FF6B35' }, // current app default
  { key: 'cognac', hex: '#B8642C' },
  { key: 'coral', hex: '#F43F5E' },
  { key: 'burgundy', hex: '#9F1239' },
  { key: 'plum', hex: '#7C3AED' },
  { key: 'indigo', hex: '#4F46E5' },
  { key: 'navy', hex: '#1E3A8A' },
  { key: 'teal', hex: '#0D9488' },
  { key: 'forest', hex: '#16A34A' },
  { key: 'sage', hex: '#65A30D' },
  { key: 'mustard', hex: '#CA8A04' },
  { key: 'charcoal', hex: '#334155' },
];

// Normalises a hex string for equality comparison. Accepts shorthand
// + mixed case; emits #RRGGBB uppercase or null on invalid input.
function normaliseHex(hex: string | null | undefined): string | null {
  const parsed = parseHex(hex ?? null);
  if (parsed === null) return null;
  const pad = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${pad(parsed.r)}${pad(parsed.g)}${pad(parsed.b)}`;
}

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
  // The custom input is initialised with the current colour so the
  // merchant sees the current hex on focus, ready to edit.
  const customValue = customDraft ?? currentHex ?? '';
  const customParsed = parseHex(customValue);
  const customInvalid = customValue.trim() !== '' && customParsed === null;

  function applyCustom(): void {
    if (customParsed === null) return;
    const normalised = normaliseHex(customValue);
    onChange(normalised);
    setCustomDraft(null);
  }

  return (
    <div className="space-y-3" data-testid="brand-color-picker">
      {/* Detected-from-logo banner — fires whenever the extracted
          colour differs from what the merchant has applied. Phase 3
          stocks logo_dominant_color on every logo upload; this is
          the prompt the brief calls for in CHANGE 4. */}
      {showDetected ? (
        <div
          data-testid="brand-color-detected"
          className="border-accent/30 bg-accent-soft/40 flex items-center gap-2 rounded-xl border px-3 py-2"
        >
          <Sparkles size={14} className="text-accent shrink-0" aria-hidden />
          <div className="flex flex-1 items-center gap-2 text-xs">
            <span className="text-ink-2">{t('brand_color_detected')}</span>
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

      {/* Preset swatch grid. Tapping a preset writes the hex
          immediately; the autosave pipeline upstream catches the
          change. The active swatch carries a ring so the merchant
          can see what's already selected. */}
      <div className="grid grid-cols-6 gap-2" data-testid="brand-color-presets">
        {PRESET_BRAND_COLORS.map(({ key, hex }) => {
          const isActive = currentHex === hex;
          return (
            <button
              key={key}
              type="button"
              data-testid={`brand-color-preset-${key}`}
              aria-label={key}
              aria-pressed={isActive}
              onClick={() => onChange(hex)}
              className={`relative aspect-square rounded-xl border-2 transition ${
                isActive
                  ? 'border-ink ring-accent/30 ring-2 ring-offset-1'
                  : 'border-transparent hover:border-ink-4'
              }`}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>

      {/* Custom hex input. Live-parses; commits on blur or when the
          merchant taps Apply. Invalid input shows a hint and skips
          the write — null isn't written through to the profile. */}
      <div className="space-y-1">
        <label htmlFor="brand-color-custom" className="text-ink-2 block text-xs font-medium">
          {t('brand_color_custom')}
        </label>
        <div className="flex items-center gap-2">
          <ColorSwatch hex={currentHex ?? '#FF6B35'} size={32} testId="brand-color-current" />
          <input
            id="brand-color-custom"
            data-testid="brand-color-custom-input"
            type="text"
            value={customValue}
            placeholder="#FF6B35"
            onChange={(e) => setCustomDraft(e.target.value)}
            onBlur={applyCustom}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyCustom();
              }
            }}
            className="border-hair focus-visible:ring-accent/40 flex-1 rounded-xl border bg-white px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2"
          />
        </div>
        {customInvalid ? (
          <p data-testid="brand-color-custom-invalid" className="text-bad text-[11px]">
            {t('brand_color_invalid_hex')}
          </p>
        ) : null}
      </div>

      {/* Live preview — three visual proxies for where the brand
          colour shows up: pill indicator (nav active state), FAB
          dot, primary button. Reads the current selection
          directly so the merchant sees the result before any
          autosave commits. */}
      <BrandColorPreview hex={currentHex ?? '#FF6B35'} />
    </div>
  );
}

// Visual proxy for the merchant — pill on the left (nav active),
// FAB dot in the middle, primary button on the right. All read the
// hex via inline style so the preview tracks the picker without
// waiting for the autosave + applyTheme cycle.
function BrandColorPreview({ hex }: { hex: string }): JSX.Element {
  const { t } = useTranslation('settings');
  // 12% alpha version for the pill bg — same recipe applyTheme uses
  // for accent-soft when the merchant has a custom brand colour.
  const softAlpha = hexToRgba(hex, 0.12);
  return (
    <div
      data-testid="brand-color-preview"
      className="flex items-center gap-3 rounded-xl border border-dashed border-ink-4/40 p-3"
    >
      <span
        className="rounded-full px-2 py-1 text-[11px] font-medium"
        style={{ backgroundColor: softAlpha, color: hex }}
      >
        {t('brand_color_preview_pill')}
      </span>
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: hex }}
      >
        +
      </span>
      <span
        className="ml-auto rounded-md px-3 py-1 text-[11px] font-medium text-white"
        style={{ backgroundColor: hex }}
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

// Small round swatch used in the detected banner + current-colour
// indicator. Pure display — clicks on it bubble up to whatever
// wraps it.
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
