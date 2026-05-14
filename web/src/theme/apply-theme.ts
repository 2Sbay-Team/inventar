// v0.9 ADR-040 — Brand + background theming via CSS custom properties.
//
// Phase 2 reads `brand_primary_color` and `theme_bg_color` from the
// ShopProfile singleton and writes five RGB-triple variables on the
// :root element:
//
//   --color-brand-rgb       — main accent
//   --color-brand-soft-rgb  — 20% brand mixed with 80% white (chip bg)
//   --color-brand-ink-rgb   — 65% brand mixed with 35% black (text on soft)
//   --color-bg-rgb          — app background top
//   --color-bg-deep-rgb     — bg darkened 5% (paper gradient bottom)
//
// When a field is null on the profile (the default until the merchant
// picks something in Phase 4's Brand Studio), we remove the inline
// override so the :root defaults in src/styles/index.css take over —
// guaranteeing pixel-identical rendering to the pre-v0.9 build.
//
// Phase 2 deliberately does NOT honour `theme_mode`. The schema
// accepts 'light' / 'dark' / 'auto' (ADR-039) but the renderer only
// implements light theming for now. Dark presets land in a later
// release once every component is audited for dark-mode coverage.
//
// All pure transformations are exported so apply-theme.test.ts can
// pin them without touching the DOM.

import type { ShopProfile } from '../types';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const BRAND_VAR = '--color-brand-rgb';
const BRAND_SOFT_VAR = '--color-brand-soft-rgb';
const BRAND_INK_VAR = '--color-brand-ink-rgb';
const BG_VAR = '--color-bg-rgb';
const BG_DEEP_VAR = '--color-bg-deep-rgb';
// v0.9.1 — ink vars (text colours) for dark-theme adaptation.
const INK_VAR = '--color-ink-rgb';
const INK_2_VAR = '--color-ink-2-rgb';
const INK_3_VAR = '--color-ink-3-rgb';
const INK_4_VAR = '--color-ink-4-rgb';

// Near-white palette used when the page background is dark (luminance < 0.08).
// Slate-100 / 300 / 400 / 500 from Tailwind's colour scale — warm-neutral,
// pairs naturally with both Slate (#1E2433) and Ink (#111111) backgrounds.
const DARK_INK = '241 245 249'; // slate-100  #F1F5F9
const DARK_INK_2 = '203 213 225'; // slate-300  #CBD5E1
const DARK_INK_3 = '148 163 184'; // slate-400  #94A3B8
const DARK_INK_4 = '100 116 139'; // slate-500  #64748B

// WCAG relative luminance of an sRGB triple. Returns 0 (pure black) … 1
// (pure white). Values below ~0.08 are "dark" for our purposes.
function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// Parses `#RGB` or `#RRGGBB` into an integer triple. Returns null on
// anything else — invalid input drops through to the CSS default
// rather than crashing the app at boot.
export function parseHex(hex: string | null | undefined): Rgb | null {
  if (typeof hex !== 'string') return null;
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const body = match[1]!;
  // Expand `#abc` to `#aabbcc` before splitting.
  const full =
    body.length === 3 ? body[0]! + body[0]! + body[1]! + body[1]! + body[2]! + body[2]! : body;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

// Tailwind v3 reads `rgb(var(--x) / <alpha-value>)`, where `<alpha-value>`
// expects a space-separated triple inside `rgb()`. Stringifying via
// `r g b` (not `r,g,b`) is the only shape that works.
export function rgbToTriple({ r, g, b }: Rgb): string {
  return `${r} ${g} ${b}`;
}

// Mix two colours by linear-interpolating each channel. `ratio` is the
// weight of the `a` colour — 0 = all `b`, 1 = all `a`.
export function mixRgb(a: Rgb, b: Rgb, ratio: number): Rgb {
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  return {
    r: clamp(a.r * ratio + b.r * (1 - ratio)),
    g: clamp(a.g * ratio + b.g * (1 - ratio)),
    b: clamp(a.b * ratio + b.b * (1 - ratio)),
  };
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

// Soft tint: 20% brand + 80% white. The current accent-soft (#FFE4D6
// for #FF6B35) lands around 0.18-0.20 in the reverse direction; we
// commit to 0.20 as the standard so a custom brand picks up a
// matching tint without the merchant having to dial it in manually.
export function softTint(brand: Rgb): Rgb {
  return mixRgb(brand, WHITE, 0.2);
}

// Ink: 65% brand + 35% black. Produces a darker version of the brand
// for text rendered on top of accent-soft chips. The current
// accent-ink (#C44417 for #FF6B35) was hand-picked; this formula
// gives a similar visual weight for arbitrary brand colours.
export function inkShade(brand: Rgb): Rgb {
  return mixRgb(brand, BLACK, 0.65);
}

// bg-deep gradient stop: slightly lighter for dark backgrounds, slightly
// darker for light backgrounds. Both give a subtle depth gradient without
// looking flat. The 8% white mix on dark is enough to read as a gradient
// without washing out the dark tone.
export function bgDeepShade(bg: Rgb): Rgb {
  if (relativeLuminance(bg) < 0.08) {
    // Dark bg → lighten by 8% so the gradient goes dark→slightly-less-dark.
    return mixRgb(bg, WHITE, 0.08);
  }
  // Light bg → darken by 5% (original formula, keeps the sunrise feel).
  return mixRgb(bg, BLACK, 0.95);
}

// Computes the five RGB triples for a given profile. Pure — no DOM
// access — so it round-trips cleanly in unit tests. Returns
// `null` for any field the profile leaves null, so the caller can
// distinguish "merchant did not override" (remove the inline style,
// let :root default win) from "merchant chose this colour".
export interface ThemeVars {
  brand: string | null;
  brandSoft: string | null;
  brandInk: string | null;
  bg: string | null;
  bgDeep: string | null;
}

export function computeThemeVars(profile: ShopProfile | null | undefined): ThemeVars {
  const brandRgb = parseHex(profile?.brand_primary_color ?? null);
  const bgRgb = parseHex(profile?.theme_bg_color ?? null);
  return {
    brand: brandRgb ? rgbToTriple(brandRgb) : null,
    brandSoft: brandRgb ? rgbToTriple(softTint(brandRgb)) : null,
    brandInk: brandRgb ? rgbToTriple(inkShade(brandRgb)) : null,
    bg: bgRgb ? rgbToTriple(bgRgb) : null,
    bgDeep: bgRgb ? rgbToTriple(bgDeepShade(bgRgb)) : null,
  };
}

// The narrow slice of CSSStyleDeclaration applyTheme exercises. Tests
// pass in a plain object that mirrors the same shape so they don't need
// a full DOM (vitest runs in node by default — no jsdom in this repo).
export interface StyleTarget {
  setProperty(name: string, value: string): void;
  removeProperty(name: string): string;
}

// Writes (or clears) the five theme variables on document.documentElement.
// Null fields → removeProperty so the :root CSS default applies. Non-null
// → setProperty with the computed triple.
//
// Idempotent: calling with the same profile twice produces the same DOM
// state. Calling with `null` strips every override (used in tests).
//
// `target` is parameterised purely for testability — production code
// never passes it and we always hit documentElement.style.
export function applyTheme(profile: ShopProfile | null | undefined, target?: StyleTarget): void {
  const root: StyleTarget | null = target ?? resolveDocumentRoot();
  if (root === null) return;
  const vars = computeThemeVars(profile);

  const pairs: ReadonlyArray<readonly [string, string | null]> = [
    [BRAND_VAR, vars.brand],
    [BRAND_SOFT_VAR, vars.brandSoft],
    [BRAND_INK_VAR, vars.brandInk],
    [BG_VAR, vars.bg],
    [BG_DEEP_VAR, vars.bgDeep],
  ];
  for (const [name, value] of pairs) {
    if (value === null) {
      root.removeProperty(name);
    } else {
      root.setProperty(name, value);
    }
  }

  // Ink-colour adaptation: when the page background is dark (luminance < 0.08)
  // flip text tokens to a near-white palette so text stays readable without
  // touching individual components. When bg is light or unset, remove the
  // overrides so :root CSS defaults (dark text) take over.
  const bgRgb = parseHex(profile?.theme_bg_color ?? null);
  const isDark = bgRgb !== null && relativeLuminance(bgRgb) < 0.08;
  const inkPairs: ReadonlyArray<readonly [string, string | null]> = [
    [INK_VAR, isDark ? DARK_INK : null],
    [INK_2_VAR, isDark ? DARK_INK_2 : null],
    [INK_3_VAR, isDark ? DARK_INK_3 : null],
    [INK_4_VAR, isDark ? DARK_INK_4 : null],
  ];
  for (const [name, value] of inkPairs) {
    if (value === null) {
      root.removeProperty(name);
    } else {
      root.setProperty(name, value);
    }
  }
}

// Returns documentElement.style when running in a browser, null
// otherwise. Centralises the typeof guard so applyTheme reads cleanly.
function resolveDocumentRoot(): StyleTarget | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.style;
}
