import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getReadableTextColor, normaliseHex } from '../utils/contrast';

interface RadialColourOption {
  key: string;
  hex: string;
}

const RADIAL_COLOURS: readonly RadialColourOption[] = [
  { key: 'red', hex: '#DC2626' },
  { key: 'rose', hex: '#E11D48' },
  { key: 'pink', hex: '#DB2777' },
  { key: 'fuchsia', hex: '#C026D3' },
  { key: 'purple', hex: '#7C3AED' },
  { key: 'violet', hex: '#6D28D9' },
  { key: 'indigo', hex: '#4F46E5' },
  { key: 'blue', hex: '#2563EB' },
  { key: 'sky', hex: '#0EA5E9' },
  { key: 'cyan', hex: '#0891B2' },
  { key: 'turquoise', hex: '#06B6D4' },
  { key: 'teal', hex: '#0D9488' },
  { key: 'emerald', hex: '#059669' },
  { key: 'green', hex: '#16A34A' },
  { key: 'lime', hex: '#65A30D' },
  { key: 'olive', hex: '#A3A01E' },
  { key: 'yellow', hex: '#EAB308' },
  { key: 'amber', hex: '#D97706' },
  { key: 'orange', hex: '#F97316' },
  { key: 'brand_orange', hex: '#FF6B35' },
  { key: 'brown', hex: '#92400E' },
  { key: 'cognac', hex: '#B8642C' },
  { key: 'slate', hex: '#334155' },
  { key: 'ink', hex: '#111827' },
];

interface RadialColorPickerProps {
  selectedHex: string | null;
  onChange: (hex: string) => void;
}

export function RadialColorPicker({ selectedHex, onChange }: RadialColorPickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  const normalisedSelected = normaliseHex(selectedHex);
  const selectedTextColor = getReadableTextColor(normalisedSelected ?? '#FF6B35');

  const positionedColours = useMemo(() => {
    const radius = 44;
    return RADIAL_COLOURS.map((colour, index) => {
      const angle = (index / RADIAL_COLOURS.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...colour,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
    });
  }, []);

  return (
    <div
      className="rounded-2xl border border-dashed border-ink-4/60 bg-white/70 p-3"
      data-testid="brand-color-radial"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-ink text-xs font-semibold">{t('brand_color_radial')}</p>
          <p className="text-ink-3 mt-0.5 text-[11px] leading-4">{t('brand_color_radial_hint')}</p>
        </div>
        <span className="text-ink-3 rounded-full bg-paper px-2 py-1 font-mono text-[10px]">
          {normalisedSelected ?? '#FF6B35'}
        </span>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <div
          className="relative h-[132px] w-[132px] rounded-full bg-[radial-gradient(circle_at_center,#fff_0,#fff_38%,rgba(255,255,255,0)_39%),conic-gradient(from_-90deg,#dc2626,#db2777,#7c3aed,#2563eb,#06b6d4,#16a34a,#eab308,#f97316,#dc2626)]"
          role="radiogroup"
          aria-label={t('brand_color_radial')}
        >
          <div
            className="absolute left-1/2 top-1/2 flex h-[54px] w-[54px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-ink-4/40 text-[10px] font-semibold shadow-sm"
            style={{ backgroundColor: normalisedSelected ?? '#FF6B35', color: selectedTextColor }}
          >
            {t('brand_color_radial_center')}
          </div>

          {positionedColours.map(({ key, hex, x, y }) => {
            const active = normalisedSelected === hex;
            const markerColor = getReadableTextColor(hex);
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`${t('brand_color_title')} ${key}`}
                data-testid={`brand-color-radial-${key}`}
                onClick={() => onChange(hex)}
                className={`absolute left-1/2 top-1/2 h-6 w-6 rounded-full border-2 transition-all duration-150 active:scale-90 ${
                  active
                    ? 'border-ink shadow-md ring-2 ring-white'
                    : 'border-white/90 shadow-sm hover:scale-110'
                }`}
                style={{
                  backgroundColor: hex,
                  transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                }}
              >
                {active ? (
                  <span
                    className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ backgroundColor: markerColor }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="w-full max-w-[220px] rounded-xl bg-paper/70 p-3 text-[11px] text-ink-3 sm:w-[180px]">
          <p className="font-medium text-ink-2">{t('brand_color_radial_tip_title')}</p>
          <p className="mt-1 leading-4">{t('brand_color_radial_tip')}</p>
        </div>
      </div>
    </div>
  );
}
