import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseHex } from '../theme/apply-theme';

// v0.9 ADR-040 — App theme background picker. Light presets only;
// dark-mode support (Slate, Ink) is not yet implemented across all
// screens so those presets are omitted rather than shown as locked.
//
// Picking a preset writes theme_bg_color through the autosave
// pipeline. Phase 2's applyTheme then recomputes --color-bg-rgb +
// --color-bg-deep-rgb (5% darker) on :root, re-painting the cream
// gradient under every screen.
//
// "Cream" is the app's pre-v0.9 default. Setting it explicitly
// stores the hex on the profile so the picker can show its
// selected state. A `null` brand_bg_color reads as "no preset
// selected" — the picker shows Cream highlighted only when the
// stored value matches its hex exactly.

interface ThemePreset {
  key: 'cream' | 'white' | 'stone' | 'slate' | 'ink';
  hex: string;
}

const THEME_PRESETS: readonly ThemePreset[] = [
  { key: 'cream', hex: '#FFF8F2' }, // current default
  { key: 'white', hex: '#FFFFFF' },
  { key: 'stone', hex: '#F0EDE8' },
  { key: 'slate', hex: '#1E2433' },
  { key: 'ink', hex: '#111111' },
];

function normaliseHex(hex: string | null | undefined): string | null {
  const parsed = parseHex(hex ?? null);
  if (parsed === null) return null;
  const pad = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${pad(parsed.r)}${pad(parsed.g)}${pad(parsed.b)}`;
}

export interface AppThemePickerProps {
  themeBgColor: string | null;
  brandPrimaryColor: string | null;
  onChange: (hex: string | null) => void;
}

export function AppThemePicker({
  themeBgColor,
  brandPrimaryColor,
  onChange,
}: AppThemePickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  const currentHex = normaliseHex(themeBgColor);

  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const customValue = customDraft ?? currentHex ?? '';
  const customParsed = parseHex(customValue);
  const customInvalid = customValue.trim() !== '' && customParsed === null;

  function applyCustom(): void {
    if (customParsed === null) return;
    onChange(normaliseHex(customValue));
    setCustomDraft(null);
  }

  return (
    <div className="space-y-3" data-testid="app-theme-picker">
      <div className="grid grid-cols-5 gap-2" data-testid="theme-presets">
        {THEME_PRESETS.map((preset) => {
          const isActive = currentHex === normaliseHex(preset.hex);
          return (
            <button
              key={preset.key}
              type="button"
              data-testid={`theme-preset-${preset.key}`}
              aria-label={preset.key}
              aria-pressed={isActive}
              onClick={() => onChange(preset.hex)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-1.5 transition ${
                isActive
                  ? 'border-ink ring-accent/30 ring-2 ring-offset-1'
                  : 'border-transparent hover:border-ink-4'
              }`}
            >
              <span
                className="block aspect-square w-full rounded-lg border border-ink-4/30"
                style={{ backgroundColor: preset.hex }}
              />
              <span className="text-[11px] font-medium">{t(`theme_preset_${preset.key}`)}</span>
            </button>
          );
        })}
      </div>

      {/* Custom hex input. Same shape as the brand picker's. */}
      <div className="space-y-1">
        <label htmlFor="theme-bg-custom" className="text-ink-2 block text-xs font-medium">
          {t('theme_custom')}
        </label>
        <input
          id="theme-bg-custom"
          data-testid="theme-bg-custom-input"
          type="text"
          value={customValue}
          placeholder="#FFF8F2"
          onChange={(e) => setCustomDraft(e.target.value)}
          onBlur={applyCustom}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyCustom();
            }
          }}
          className="border-hair focus-visible:ring-accent/40 w-full rounded-xl border bg-white px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-2"
        />
        {customInvalid ? (
          <p data-testid="theme-bg-custom-invalid" className="text-bad text-[11px]">
            {t('brand_color_invalid_hex')}
          </p>
        ) : null}
      </div>

      {/* Mini app preview — a phone-shaped widget rendering the
          current bg + brand combination. Pure CSS, no real
          screenshot — just shapes the merchant can recognise. */}
      <MiniAppPreview
        bgHex={currentHex ?? '#FFF8F2'}
        brandHex={normaliseHex(brandPrimaryColor) ?? '#FF6B35'}
      />
    </div>
  );
}

function MiniAppPreview({ bgHex, brandHex }: { bgHex: string; brandHex: string }): JSX.Element {
  const { t } = useTranslation('settings');
  // 5% darker = the bg-deep value applyTheme generates for the
  // paper gradient bottom. Inline-computed here so the preview
  // matches the live render.
  const bgDeep = darken(bgHex, 0.95);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        data-testid="theme-preview"
        className="border-ink-4/40 relative h-[180px] w-[110px] overflow-hidden rounded-2xl border shadow-sm"
        style={{
          background: `linear-gradient(180deg, ${bgHex} 0%, ${bgDeep} 100%)`,
        }}
        aria-label={t('theme_preview_label')}
      >
        {/* Header bar */}
        <div className="absolute inset-x-0 top-0 h-5 bg-white/40 backdrop-blur-sm">
          <span className="absolute top-1 left-2 h-2 w-10 rounded-full bg-ink/20" />
          <span
            className="absolute right-2 top-1 h-2 w-2 rounded-full"
            style={{ backgroundColor: brandHex }}
          />
        </div>
        {/* Card */}
        <div className="absolute inset-x-3 top-8 rounded-lg bg-white p-2 shadow-sm">
          <div className="h-1.5 w-12 rounded-full bg-ink/30" />
          <div className="mt-1 h-1 w-16 rounded-full bg-ink/15" />
          <div className="mt-1.5 flex gap-1">
            <span
              className="rounded-full px-1.5 py-0.5 text-[7px] font-medium"
              style={{
                backgroundColor: `${brandHex}1F`,
                color: brandHex,
              }}
            >
              ●
            </span>
          </div>
        </div>
        {/* FAB */}
        <span
          className="absolute right-2 bottom-7 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white shadow"
          style={{ backgroundColor: brandHex }}
        >
          +
        </span>
        {/* Bottom nav */}
        <div className="absolute inset-x-1 bottom-1 flex h-5 items-center justify-around rounded-lg bg-white/85 backdrop-blur-sm shadow-sm">
          <span className="h-1 w-3 rounded-full" style={{ backgroundColor: brandHex }} />
          <span className="h-1 w-3 rounded-full bg-ink/30" />
          <span className="h-1 w-3 rounded-full bg-ink/30" />
          <span className="h-1 w-3 rounded-full bg-ink/30" />
        </div>
      </div>
      <span className="text-ink-3 text-[10px]">{t('theme_preview_label')}</span>
    </div>
  );
}

// Multiplies each RGB channel by `factor`. Same recipe applyTheme
// uses for bg-deep. Returns `#RRGGBB`.
function darken(hex: string, factor: number): string {
  const parsed = parseHex(hex);
  if (parsed === null) return hex;
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n * factor)));
  const pad = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${pad(clamp(parsed.r))}${pad(clamp(parsed.g))}${pad(clamp(parsed.b))}`;
}
