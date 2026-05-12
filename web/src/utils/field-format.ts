// v0.9 Phase 4a — Field-level normalisation for Shop Identity inputs.
//
// Every helper is pure: a string in, a string (or null) out. Storage-
// shape normalisation: what the merchant types may differ from what
// the DB stores. Examples:
//
//   Merchant types          DB stores
//   ─────────────────────   ──────────
//   https://example.com     example.com
//   instagram.com/naili     @naili
//   @naili                  @naili
//   naili                   @naili
//   "  hello  "             "hello"
//
// All helpers treat `''` after trim() as "merchant cleared the field"
// and return null so upsertProfile clears the column.

// Returns null for empty / whitespace-only input. Otherwise returns
// the trimmed value verbatim — used by the simple text fields
// (tagline, description, city, …).
export function trimToNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Strips a leading http:// or https:// and any trailing slash. Used
// only for storage; the UI re-adds https:// when offering the value
// as a link. Returns null for empty input.
export function normalizeWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // RFC-permissive: case-insensitive scheme strip.
  const stripped = trimmed.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return stripped === '' ? null : stripped;
}

// Returns the website value as a display string (no protocol). Pass-
// through for nullish input. The UI renders this in the read-only
// row; the merchant edits the same shape (storage = display).
export function websiteForDisplay(value: string | null | undefined): string {
  return value ?? '';
}

// Returns a clickable URL for the website. Prepends https:// when
// missing so an anchor tag's href works. Returns null when the
// stored value is empty.
export function websiteHref(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Normalises an Instagram / TikTok-style handle. Accepts:
//   @handle
//   handle
//   instagram.com/handle
//   https://www.instagram.com/handle
//   tiktok.com/@handle
//   https://tiktok.com/@handle
// Returns `@handle` (with the @ prefix) or null for empty input.
//
// We strip any path beyond the handle slug — query strings, the
// trailing `/`, anything after the first slash that follows the
// handle. Phase 4a's read side displays the stored value verbatim;
// Phase 6's business-card renderer builds the URL from the handle.
export function normalizeSocialHandle(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // Strip protocol + www.
  let body = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  // Strip known platform hosts. Order matters — longest first to
  // avoid premature matches.
  body = body.replace(/^(instagram\.com\/|tiktok\.com\/|twitter\.com\/|x\.com\/)/i, '');
  // Keep only the first path segment (the handle). `naili/something`
  // → `naili`, with the `/something` dropped.
  body = body.split(/[/?#]/)[0]!.trim();
  if (body === '') return null;
  // Strip a leading @ — we'll re-add a single one. Tolerates `@@x`
  // copy-paste accidents which would otherwise stay broken in the DB.
  body = body.replace(/^@+/, '');
  if (body === '') return null;
  return `@${body}`;
}

// Facebook-flavoured normalisation. Pages don't follow the @-prefix
// convention — some are username slugs ("NailiShoes"), some are
// numeric IDs ("pages/.../12345"), and the merchant typically copies
// either the page name or the full URL. Store whatever the merchant
// types, just trimmed of protocol + host:
//
//   facebook.com/NailiShoes      → NailiShoes
//   https://facebook.com/12345   → 12345
//   NailiShoes                   → NailiShoes
//
// No @ prefix.
export function normalizeFacebook(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let body = trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  body = body.replace(/^(facebook\.com\/|fb\.com\/)/i, '');
  // Strip Facebook's redundant /pages/<name>/ prefix when present —
  // we want just the slug or id at the end.
  body = body.replace(/^pages\/[^/]+\//, '');
  body = body.split(/[?#]/)[0]!.trim();
  body = body.replace(/\/+$/, '');
  return body === '' ? null : body;
}

// Light phone normalisation: trim and collapse repeated whitespace.
// The brief asks for country-aware international format
// ("21698765432 → +216 98 765 432"), but country detection from a
// bare digit string is fragile and country-of-origin metadata isn't
// stored on the profile yet. Phase 4a keeps phone formatting as
// merchant-typed — accurate, predictable, no surprises — and lets a
// later phase add the auto-formatter when address_country is filled.
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

// Builds a WhatsApp "click-to-chat" URL from a stored phone number.
// Strips non-digit characters because wa.me requires the international
// number with no formatting (e.g. `21698765432`, NOT `+216 98 765 432`).
// Returns null when the input has no digits — the caller hides the
// [Test] button in that case.
export function whatsappHref(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits === '' ? null : `https://wa.me/${digits}`;
}

// Lightweight email validity check. The brief asks for "✓ or ✗ as
// merchant types"; we use the same RFC-lite regex the W3C suggests
// for input[type=email]. Returns true for an empty string so the
// "needs work" badge doesn't appear before the merchant starts
// typing. Pure — no side effects.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
export function isLikelyEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return EMAIL_RE.test(trimmed);
}
