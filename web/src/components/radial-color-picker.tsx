import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReadableTextColor } from '../utils/contrast';

// Brand palette stays vivid: any hue at 70% sat / 55% lightness.
const BRAND_S = 70;
const BRAND_L = 55;
const RING_INNER = 70;
const RING_OUTER = 100;
const THUMB_R = (RING_INNER + RING_OUTER) / 2; // 85

// ── Math helpers ─────────────────────────────────────────────────────────────

function polar(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

function describeArc(rInner: number, rOuter: number, a1: number, a2: number): string {
  const p1 = polar(rOuter, a1);
  const p2 = polar(rOuter, a2);
  const p3 = polar(rInner, a2);
  const p4 = polar(rInner, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return (
    `M${p1.x} ${p1.y} A${rOuter} ${rOuter} 0 ${large} 1 ${p2.x} ${p2.y} ` +
    `L${p3.x} ${p3.y} A${rInner} ${rInner} 0 ${large} 0 ${p4.x} ${p4.y} Z`
  );
}

export function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const channel = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function hexToHue(hex: string): number {
  const clean = hex.replace('#', '').toLowerCase();
  if (clean.length !== 6) return 0;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  const hue = Math.round(h * 60);
  return hue < 0 ? hue + 360 : hue;
}

// Pre-compute the 72 arc segments once — they are constant (fixed S/L).
const RING_SEGMENTS = Array.from({ length: 72 }, (_, i) => ({
  d: describeArc(RING_INNER, RING_OUTER, i * 5, (i + 1) * 5),
  fill: `hsl(${i * 5 + 2.5}, ${BRAND_S}%, ${BRAND_L}%)`,
}));

// ── Component ─────────────────────────────────────────────────────────────────

interface RadialColorPickerProps {
  selectedHex: string | null;
  onChange: (hex: string) => void;
}

export function RadialColorPicker({ selectedHex, onChange }: RadialColorPickerProps): JSX.Element {
  const { t } = useTranslation('settings');
  const svgRef = useRef<SVGSVGElement>(null);
  const isDragging = useRef(false);

  const [hue, setHue] = useState(() => hexToHue(selectedHex ?? '#FF6B35'));

  // Sync when parent changes selectedHex externally (e.g. hex text input).
  useEffect(() => {
    setHue(hexToHue(selectedHex ?? '#FF6B35'));
  }, [selectedHex]);

  const thumbPos = polar(THUMB_R, hue);
  const centerHex = hslToHex(hue, BRAND_S, BRAND_L);
  const centerTextColor = getReadableTextColor(centerHex);

  function angleFromPointer(e: { clientX: number; clientY: number }): number {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    if (angle >= 360) angle -= 360;
    return angle;
  }

  function applyAngle(angle: number): void {
    const snapped = (Math.round(angle / 5) * 5) % 360;
    setHue(snapped);
    onChange(hslToHex(snapped, BRAND_S, BRAND_L));
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>): void {
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    applyAngle(angleFromPointer(e));
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>): void {
    if (!isDragging.current) return;
    applyAngle(angleFromPointer(e));
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>): void {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleKeyDown(e: React.KeyboardEvent<SVGSVGElement>): void {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = (hue + 5) % 360;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = (hue - 5 + 360) % 360;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 355;
    if (next !== null) {
      e.preventDefault();
      setHue(next);
      onChange(hslToHex(next, BRAND_S, BRAND_L));
    }
  }

  return (
    <div
      className="rounded-2xl border border-dashed border-ink-4/60 bg-white/70 p-3"
      data-testid="brand-color-radial"
    >
      {/* Header row */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-ink text-xs font-semibold">{t('brand_color_radial')}</p>
          <p className="text-ink-3 mt-0.5 text-[11px] leading-4">{t('brand_color_radial_hint')}</p>
        </div>
        <span className="text-ink-3 rounded-full bg-paper px-2 py-1 font-mono text-[10px]">
          {centerHex}
        </span>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        {/* Hue wheel SVG */}
        <svg
          ref={svgRef}
          width="220"
          height="220"
          viewBox="-110 -110 220 220"
          role="slider"
          aria-label={t('brand_color_radial')}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={hue}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onKeyDown={handleKeyDown}
          className="cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {/* 72 arc segments — full hue ring */}
          {RING_SEGMENTS.map((seg, i) => (
            <path key={i} d={seg.d} fill={seg.fill} />
          ))}

          {/* Donut hole — white fill to create the ring illusion */}
          <circle cx={0} cy={0} r={RING_INNER - 1} fill="white" />

          {/* Center color preview disc */}
          <circle cx={0} cy={0} r={44} fill={centerHex} />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fontSize={9}
            fontWeight="700"
            letterSpacing="0.04em"
            fill={centerTextColor}
            style={{ userSelect: 'none', pointerEvents: 'none' }}
          >
            {t('brand_color_radial_center')}
          </text>

          {/* Draggable thumb: outer white ring + inner hue fill */}
          <circle
            cx={thumbPos.x}
            cy={thumbPos.y}
            r={14}
            fill="white"
            stroke={centerHex}
            strokeWidth={3}
            style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))' }}
          />
          <circle cx={thumbPos.x} cy={thumbPos.y} r={7} fill={centerHex} />
        </svg>

        {/* Tip card */}
        <div className="w-full max-w-[220px] rounded-xl bg-paper/70 p-3 text-[11px] text-ink-3 sm:w-[180px]">
          <p className="font-medium text-ink-2">{t('brand_color_radial_tip_title')}</p>
          <p className="mt-1 leading-4">{t('brand_color_radial_tip')}</p>
        </div>
      </div>
    </div>
  );
}
