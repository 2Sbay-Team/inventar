import { STORE_TYPES } from './store-types';
import { type Article, type ShopProfile, type StoreType } from '../types';

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

export type Uom = 'piece' | 'kg' | 'g' | 'l' | 'ml';

// For UoMs where the merchant types prices "per large unit" (kg, l)
// the internal storage is "per small unit" (g, ml) so the existing
// `|qty| * sale_price_tnd` revenue math stays in millimes×smallest-unit
// and never needs special-casing. This is the conversion factor:
// merchant types "price per kg" → divide by 1000 to get "millimes per g".
const SMALL_UNIT_FACTOR: Record<Uom, number> = {
  piece: 1,
  kg: 1000, // 1 kg = 1000 g
  g: 1,
  l: 1000, // 1 l = 1000 ml
  ml: 1,
};

export function uomSmallUnitFactor(uom: Uom): number {
  return SMALL_UNIT_FACTOR[uom];
}

// Converts a price the merchant typed in their preferred unit into the
// internal "millimes per smallest unit" form.
//   - piece: 15000 mil/piece → 15000
//   - kg:    15000 mil/kg    → 15   (15 mil/g, 1 g is 1/1000 kg)
//   - g:     15 mil/g        → 15
//   - l:     2000 mil/l      → 2    (2 mil/ml)
//   - ml:    2 mil/ml        → 2
// Rounds half-up so cheap items don't silently truncate to 0.
export function inputPriceToInternal(displayMinor: number, uom: Uom): number {
  if (uom === 'piece' || uom === 'g' || uom === 'ml') return Math.round(displayMinor);
  return Math.round(displayMinor / SMALL_UNIT_FACTOR[uom]);
}

// Reverse of inputPriceToInternal — converts internal "millimes per
// smallest unit" to display millimes per UoM unit, for showing in the
// price input on edit.
export function internalPriceToInput(internalMinor: number, uom: Uom): number {
  if (uom === 'piece' || uom === 'g' || uom === 'ml') return internalMinor;
  return internalMinor * SMALL_UNIT_FACTOR[uom];
}

// Converts the merchant's typed quantity in display units to the
// internal smallest-unit integer (also rounding half-up).
//   - piece: 3 pieces       → 3
//   - kg:    0.850 kg       → 850
//   - g:     500 g          → 500
//   - l:     1.25 l         → 1250
//   - ml:    250 ml         → 250
export function inputQtyToInternal(displayQty: number, uom: Uom): number {
  if (uom === 'piece') return Math.round(displayQty);
  return Math.round(displayQty * SMALL_UNIT_FACTOR[uom]);
}

// Formats an internal smallest-unit integer qty for display under the
// article's UoM. Picks the larger unit (kg / l) when the magnitude is
// ≥ 1000, otherwise the smaller unit. Pieces always render as integers.
// Returns a paired [number, suffix] so callers can apply locale-specific
// number formatting (e.g. Eastern Arabic numerals) before concatenating.
export function formatQtyWithUom(internalQty: number, uom: Uom): { value: number; suffix: string } {
  const abs = Math.abs(internalQty);
  switch (uom) {
    case 'piece':
      return { value: internalQty, suffix: '' };
    case 'g':
      return { value: internalQty, suffix: 'g' };
    case 'ml':
      return { value: internalQty, suffix: 'ml' };
    case 'kg':
      // ≥ 1 kg → render in kg with up to 3 decimal places.
      return abs >= 1000
        ? { value: internalQty / 1000, suffix: 'kg' }
        : { value: internalQty, suffix: 'g' };
    case 'l':
      return abs >= 1000
        ? { value: internalQty / 1000, suffix: 'l' }
        : { value: internalQty, suffix: 'ml' };
    default:
      // Defensive fallback for un-migrated rows or fashion variants that
      // sneak an undefined/unknown uom past the type checker at runtime.
      // Without this every quantity surface (dashboard, alerts, quick
      // adjust, search results) crashes the entire screen via the
      // destructure `const { value, suffix } = formatQtyWithUom(...)`.
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
