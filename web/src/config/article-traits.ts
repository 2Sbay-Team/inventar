import { STORE_TYPES } from './store-types';
import { type Article, type ShopProfile, type StoreType, type Uom } from '../types';

// Re-export Uom so existing imports of `from '../config/article-traits'`
// keep compiling unchanged. The canonical declaration lives in types/.
export type { Uom };

// v0.5.2.9 (Phase B + UoM) — single source of truth for the
// "does this article need sizes / colours / expiry" question and
// for unit-of-measure formatting + price-input conversion.
//
// Every UI site that USED to read `STORE_TYPES[store_type].has_sizes`
// (etc.) now reads through these helpers, which prefer the article-
// level override and fall back to the store_type default. The store_
// type default stays as a sensible onboarding-time starting point;
// per-article overrides let a fashion-vertical merchant sell a
// single-SKU drink, or a shop-vertical merchant sell a sized T-shirt.

// Resolves an article-level boolean trait against the store_type fallback.
// null/undefined on the article -> use the store_type default.
function resolveTrait(
  override: boolean | null | undefined,
  storeType: StoreType,
  key: 'has_sizes' | 'has_colors' | 'has_expiry',
): boolean {
  if (override === true || override === false) return override;
  return STORE_TYPES[storeType][key];
}

export function articleHasSizes(article: Article, profile: ShopProfile | null): boolean {
  return resolveTrait(article.has_sizes, profile?.store_type ?? 'shoes', 'has_sizes');
}

export function articleHasColors(article: Article, profile: ShopProfile | null): boolean {
  return resolveTrait(article.has_colors, profile?.store_type ?? 'shoes', 'has_colors');
}

export function articleHasExpiry(article: Article, profile: ShopProfile | null): boolean {
  return resolveTrait(article.has_expiry, profile?.store_type ?? 'shoes', 'has_expiry');
}

// ── Unit of measure ────────────────────────────────────────────────

// v0.5.6 — extended from the v0.5 piece/kg/g/l/ml set with three
// additional countable units (pair, pack, dozen) and meter for fabric/
// rope-style continuous goods. No schema migration: the field is a
// plain string in storage; the union just expands what the merchant
// picks from the Add Article dropdown.
// (Uom type now lives in ../types and is re-exported at the top of
// this file. The shape is duplicated in the SMALL_UNIT_FACTOR /
// CONTINUOUS_UOMS maps below — adding a new variant in types/index.ts
// requires updating those two maps too.)

// For UoMs where the merchant types prices "per large unit" (kg, l)
// the internal storage is "per small unit" (g, ml) so the existing
// `|qty| * sale_price_tnd` revenue math stays in millimes×smallest-unit
// and never needs special-casing. This is the conversion factor:
// merchant types "price per kg" → divide by 1000 to get "millimes per g".
// The countable units (piece / pair / pack / dozen) and meter all stay
// at factor 1 — the merchant types whole counts / whole meters and
// nothing is converted at storage time.
const SMALL_UNIT_FACTOR: Record<Uom, number> = {
  piece: 1,
  pair: 1,
  pack: 1,
  dozen: 1,
  kg: 1000, // 1 kg = 1000 g
  g: 1,
  l: 1000, // 1 l = 1000 ml
  ml: 1,
  meter: 1,
};

// v0.5.6 — true for UoMs where stock is a measured/continuous quantity
// (weight, volume, length). Articles in these UoMs don't have a per-
// variant size + colour matrix — a 250 g packet of coffee or a roll
// of fabric has no "size 42 in blue". Add Article suppresses the
// size + colour pickers when this returns true.
const CONTINUOUS_UOMS: ReadonlySet<Uom> = new Set(['kg', 'g', 'l', 'ml', 'meter']);

export function isContinuousUom(uom: Uom): boolean {
  return CONTINUOUS_UOMS.has(uom);
}

export function uomSmallUnitFactor(uom: Uom): number {
  return SMALL_UNIT_FACTOR[uom];
}

// v0.5.6 — initial Unit selection for the Add Article form.
//   • Fashion + ONLY shoes / shoes_kids sub-types → 'pair'
//   • Fashion + any other (or mixed) sub-type     → 'piece'
//   • Shop / unset profile                        → 'piece'
// Mixed defaults to 'piece' on purpose: a merchant whose profile has
// shoes AND clothing_men is most likely adding a clothing item; a
// silent 'Pair' default would be wrong nine times out of ten.
export function defaultUomForProfile(
  profile:
    | {
        store_type: StoreType;
        fashion_subtypes?: readonly string[];
      }
    | null
    | undefined,
): Uom {
  if (!profile || profile.store_type !== 'fashion') return 'piece';
  const subs = profile.fashion_subtypes ?? [];
  if (subs.length === 0) return 'piece';
  const shoesRelated: ReadonlySet<string> = new Set(['shoes', 'shoes_kids']);
  return subs.every((s) => shoesRelated.has(s)) ? 'pair' : 'piece';
}

// Converts a price the merchant typed in their preferred unit into the
// internal "millimes per smallest unit" form.
//   - piece / pair / pack / dozen / g / ml / meter: pass-through (factor 1)
//   - kg / l: divide by 1000 to convert per-kg → per-g, per-l → per-ml
// Rounds half-up so cheap items don't silently truncate to 0.
export function inputPriceToInternal(displayMinor: number, uom: Uom): number {
  return SMALL_UNIT_FACTOR[uom] === 1
    ? Math.round(displayMinor)
    : Math.round(displayMinor / SMALL_UNIT_FACTOR[uom]);
}

// Reverse of inputPriceToInternal — converts internal "millimes per
// smallest unit" to display millimes per UoM unit, for showing in the
// price input on edit.
export function internalPriceToInput(internalMinor: number, uom: Uom): number {
  return SMALL_UNIT_FACTOR[uom] === 1 ? internalMinor : internalMinor * SMALL_UNIT_FACTOR[uom];
}

// Converts the merchant's typed quantity in display units to the
// internal smallest-unit integer (also rounding half-up).
//   - piece / pair / pack / dozen / meter: pass-through, Math.round
//   - kg:    0.850 kg → 850 (×1000 = g)
//   - g:     500 g    → 500
//   - l:     1.25 l   → 1250 (×1000 = ml)
//   - ml:    250 ml   → 250
export function inputQtyToInternal(displayQty: number, uom: Uom): number {
  return SMALL_UNIT_FACTOR[uom] === 1
    ? Math.round(displayQty)
    : Math.round(displayQty * SMALL_UNIT_FACTOR[uom]);
}

// Formats an internal smallest-unit integer qty for display under the
// article's UoM. Countable UoMs (piece / pair / pack / dozen / meter)
// render as a bare integer — the unit is communicated by the dropdown
// next to the value rather than appended as a suffix. kg / l auto-pick
// the larger unit when magnitude crosses 1000.
//
// Returns a paired [number, suffix] so callers can apply locale-specific
// number formatting (e.g. Eastern Arabic numerals) before concatenating.
export function formatQtyWithUom(internalQty: number, uom: Uom): { value: number; suffix: string } {
  const abs = Math.abs(internalQty);
  switch (uom) {
    case 'piece':
    case 'pair':
    case 'pack':
    case 'dozen':
    case 'meter':
      return { value: internalQty, suffix: '' };
    case 'g':
      return { value: internalQty, suffix: 'g' };
    case 'ml':
      return { value: internalQty, suffix: 'ml' };
    case 'kg':
      return abs >= 1000
        ? { value: internalQty / 1000, suffix: 'kg' }
        : { value: internalQty, suffix: 'g' };
    case 'l':
      return abs >= 1000
        ? { value: internalQty / 1000, suffix: 'l' }
        : { value: internalQty, suffix: 'ml' };
    default:
      // Defensive fallback for un-migrated rows or fashion variants
      // that sneak an undefined/unknown uom past the type checker at
      // runtime. Without this every quantity surface (dashboard,
      // alerts, quick-adjust, search results) crashes the screen via
      // `const { value, suffix } = formatQtyWithUom(...)`.
      return { value: internalQty, suffix: '' };
  }
}

// Convenience: produce a display string for a quantity. Caller still
// owns locale-specific number formatting via Intl.NumberFormat if it
// matters (Arabic Eastern numerals).
export function formatQtyString(internalQty: number, uom: Uom): string {
  const { value, suffix } = formatQtyWithUom(internalQty, uom);
  if (suffix === '') return String(value);
  // Trim trailing zeros from "1.250 kg" → "1.25 kg", "1.000 kg" → "1 kg".
  const text =
    Number.isInteger(value) || uom === 'g' || uom === 'ml'
      ? String(value)
      : value.toFixed(3).replace(/\.?0+$/, '');
  return `${text} ${suffix}`;
}
