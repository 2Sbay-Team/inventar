// v0.9 Phase 5 — Shop Identity profile completion score.
//
// Counts how many of 12 "soft-required" fields the merchant has
// filled and returns the percentage + which milestone tier they've
// unlocked. The milestones are PURELY INFORMATIONAL — the brief's
// "60% unlocks invoices" wording is a nudge, not a gate. Invoices
// work today for every merchant regardless of this score. This
// module exists to point the merchant at what they should fill
// NEXT, not to block them from doing anything.
//
// Tracked fields (12, ~8.3% each):
//
//   logo_photo_id            — any logo uploaded
//   tagline                  — one-line shop tagline
//   description              — 300-char invoice/catalogue description
//   phone                    — merchant phone
//   whatsapp                 — WhatsApp number
//   email                    — contact email
//   address_street           — structured address
//   address_city
//   address_country
//   fiscal_id                — Tax ID (matricule fiscal / SIRET / VAT)
//   legal_name               — legal business name
//   brand_color              — either brand_primary_color (explicit
//                              merchant pick) OR logo_dominant_color
//                              (auto-extracted from logo). Either
//                              "fills" this slot so a merchant who
//                              uploads a logo and accepts the
//                              detected colour gets credit for both.
//
// Excluded:
//   - shop name + locale + currency + store_type. Always filled at
//     onboarding, so they'd shift the baseline percentage and add
//     no signal.
//   - shop_subtypes / fashion_subtypes. Required at onboarding too.
//   - opening_hours. Phase 7 ships them; until then the field
//     doesn't render in the UI, so counting it would be confusing.
//   - social handles. Many legitimate shops don't use any of
//     Instagram / Facebook / TikTok and shouldn't be dinged.
//   - website. Many local merchants don't have one; same reason.

import type { ShopProfile } from '../types';

export type MilestoneKey = 'receipts' | 'invoices' | 'catalog' | 'business_card';

export interface Milestone {
  key: MilestoneKey;
  threshold: number; // percentage (0-100)
}

// Sorted ascending by threshold. The 30/60/80/100 split mirrors the
// brief's CHANGE 2 completion milestones table.
export const MILESTONES: readonly Milestone[] = [
  { key: 'receipts', threshold: 30 },
  { key: 'invoices', threshold: 60 },
  { key: 'catalog', threshold: 80 },
  { key: 'business_card', threshold: 100 },
];

export type CompletionFieldKey =
  | 'logo'
  | 'tagline'
  | 'description'
  | 'phone'
  | 'whatsapp'
  | 'email'
  | 'address_street'
  | 'address_city'
  | 'address_country'
  | 'fiscal_id'
  | 'legal_name'
  | 'brand_color';

interface CompletionField {
  key: CompletionFieldKey;
  predicate: (profile: ShopProfile) => boolean;
}

function isFilledString(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

const FIELDS: readonly CompletionField[] = [
  { key: 'logo', predicate: (p) => p.logo_photo_id !== null },
  { key: 'tagline', predicate: (p) => isFilledString(p.tagline) },
  { key: 'description', predicate: (p) => isFilledString(p.description) },
  { key: 'phone', predicate: (p) => isFilledString(p.phone) },
  { key: 'whatsapp', predicate: (p) => isFilledString(p.whatsapp) },
  { key: 'email', predicate: (p) => isFilledString(p.email) },
  { key: 'address_street', predicate: (p) => isFilledString(p.address_street) },
  { key: 'address_city', predicate: (p) => isFilledString(p.address_city) },
  { key: 'address_country', predicate: (p) => isFilledString(p.address_country) },
  { key: 'fiscal_id', predicate: (p) => isFilledString(p.fiscal_id) },
  { key: 'legal_name', predicate: (p) => isFilledString(p.legal_name) },
  {
    key: 'brand_color',
    // Either the explicit pick OR the auto-extracted dominant
    // colour counts. A merchant who uploads a logo + accepts the
    // ✨ detected suggestion gets a single "yes, you've picked
    // a brand colour" credit.
    predicate: (p) =>
      isFilledString(p.brand_primary_color) || isFilledString(p.logo_dominant_color),
  },
];

export const COMPLETION_FIELD_COUNT = FIELDS.length;

export interface CompletionResult {
  filled: number;
  total: number;
  percentage: number; // 0-100, rounded
  unlocked: readonly MilestoneKey[];
  next: Milestone | null; // null when everything is done
  filledFields: readonly CompletionFieldKey[];
  missingFields: readonly CompletionFieldKey[];
}

export function computeCompletion(profile: ShopProfile): CompletionResult {
  const filledKeys: CompletionFieldKey[] = [];
  const missingKeys: CompletionFieldKey[] = [];
  for (const field of FIELDS) {
    if (field.predicate(profile)) filledKeys.push(field.key);
    else missingKeys.push(field.key);
  }
  const filled = filledKeys.length;
  const total = FIELDS.length;
  const percentage = Math.round((filled / total) * 100);
  const unlocked: MilestoneKey[] = [];
  let next: Milestone | null = null;
  for (const milestone of MILESTONES) {
    if (percentage >= milestone.threshold) {
      unlocked.push(milestone.key);
    } else if (next === null) {
      next = milestone;
    }
  }
  return {
    filled,
    total,
    percentage,
    unlocked,
    next,
    filledFields: filledKeys,
    missingFields: missingKeys,
  };
}
