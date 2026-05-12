import { REDUCED_VAT_PCT_DEFAULT, type Article, type ShopProfile } from '../types';

// v0.9 ADR-041 — single resolution boundary for "what VAT rate does
// this article carry?". Every consumer that needs to compute or
// display a tax amount (invoice line, sale tax breakdown, future
// reports tax summary) reads this — no other site is allowed to
// inspect `Article.tax_category` directly so the resolution rules
// stay in one place.
//
// Inputs:
//   article  — must have `tax_category` + `tax_custom_rate`. Both
//              fields are post-migration guaranteed (null at worst)
//              so we don't accept `undefined` here.
//   profile  — the shop's singleton profile or `null` (the resolver
//              is tolerant of "profile not loaded yet"; callers can
//              pass useProfile()'s value through verbatim).
//
// Return value:
//   number   — the percent (0..100 integer) the merchant should
//              apply at the line / cart level.
//   null     — the shop hasn't configured a default VAT AND the
//              article isn't on a fixed category. Means "no tax";
//              the invoice / sale UI should hide the VAT row
//              entirely rather than show "0%".
//
// Resolution order (mirrors the brief verbatim):
//   1. tax_category === null OR 'standard'  → profile.default_vat_pct
//      ('standard' is the merchant explicitly anchoring "always
//      whatever the shop standard is" — semantically identical to
//      null today, kept distinct so a later UX can tell the two
//      cases apart without re-deriving from history.)
//   2. tax_category === 'reduced'  → REDUCED_VAT_PCT_DEFAULT (7).
//      A later release can make this configurable per shop via a
//      `reduced_vat_pct` column; until then we anchor to TN's
//      secondary band so the resolver + the Add form's "Reduced
//      (7%)" label stay in sync.
//   3. tax_category === 'zero'  → 0. Books, medical supplies, etc.
//      Returns the number 0 (not null) — the line still renders a
//      "VAT 0%" row so the customer sees the article is in scope
//      but not taxed.
//   4. tax_category === 'custom'  → tax_custom_rate. Null custom
//      rate (the input form didn't validate, or the field got
//      cleared) falls through to the profile default — same
//      behaviour as a null `tax_category`, on the principle that a
//      half-set override should never silently become a 0%-VAT bug.
export function getTaxRate(
  article: Pick<Article, 'tax_category' | 'tax_custom_rate'>,
  profile: Pick<ShopProfile, 'default_vat_pct'> | null,
): number | null {
  const category = article.tax_category;

  if (category === 'zero') return 0;
  if (category === 'reduced') return REDUCED_VAT_PCT_DEFAULT;

  if (category === 'custom') {
    const custom = article.tax_custom_rate;
    if (custom !== null && Number.isFinite(custom)) return custom;
    // Fall through: a 'custom' marker with no rate set is treated
    // the same as null — better than silently zeroing out the VAT.
  }

  // category === null OR 'standard' OR 'custom'-with-null-rate
  return profile?.default_vat_pct ?? null;
}
