// Human-readable + QR-payload code identifying a specific variant. Format
// (per the v0.3 plan answer 4):
//
//   PREFIX-NNNN[-COLOR[-SIZE]]
//
// Always hyphen-separated, single source of truth for both the printed
// sticker and the QR payload. Token-count parsing means the QR scanner
// never has to guess which trailing chunk is colour vs size.
//
// Examples:
//   shoes black 40       → SH-0001-BK-40
//   clothes black XL     → CL-0014-BK-XL
//   sized, no colour     → CL-0014--40   (not currently emitted by any
//                                          vertical, kept legal for the
//                                          parser only — see hasColors)
//   colour, no size      → CL-0014-BK    (no current vertical, but legal)
//   sizeless + colourless → KI-0042
//
// Custom colours produce CU + first-4-alnum chars; total label length never
// exceeds about 18 characters even in the worst case.

import { colorPrefix } from './color-codes';
import { type Article, type Variant } from '../types';

export interface VariantCodeContext {
  // Whether the active store_type uses colours. If false, colour is omitted
  // even when a Variant.color happens to be set.
  hasColors: boolean;
  // Whether the active store_type uses sizes. If false, size is omitted.
  hasSizes: boolean;
}

// Returns the canonical PREFIX-NNNN[-COLOR[-SIZE]] string for a variant.
// The grammar (answer 4) does not permit empty middle segments — SIZE
// follows COLOR, never replaces it. The function only appends the slots
// that are present and non-empty after applying the store-type flags. A
// row with hasColors=true but variant.color=null degrades to the bare
// article code; the QR scanner then opens the article without selecting a
// variant. This matches the article-only fallback in commit 5's routing.
export function variantCode(
  article: Pick<Article, 'internal_code'>,
  variant: Pick<Variant, 'color' | 'size'>,
  ctx: VariantCodeContext,
): string {
  const parts: string[] = [article.internal_code];
  const cp = ctx.hasColors ? colorPrefix(variant.color) : null;
  const sz = ctx.hasSizes ? (variant.size ?? '').trim() : '';

  if (cp !== null && cp !== '') parts.push(cp);
  if (sz !== '' && ((cp !== null && cp !== '') || !ctx.hasColors)) parts.push(sz);

  return parts.join('-');
}

export interface ParsedVariantCode {
  // Always: the article's full internal_code (PREFIX-NNNN).
  internalCode: string;
  // Empty string when the original code had no colour segment OR an empty
  // colour middle segment. Callers that need to disambiguate "no colour"
  // from "colour was empty" should rely on the token count via parseLevel.
  colorPrefix: string;
  // Empty string when the code had no size segment.
  size: string;
  // Number of '-' tokens in the input. Used by the search-screen scanner
  // routing to decide between article / variant-with-colour / variant-with-
  // colour-and-size paths (per commit 5 of the v0.3 plan).
  tokenCount: number;
}

// Splits a code on '-' and classifies it. Returns null for inputs that don't
// match the format (fewer than 2 tokens, or more than 4 tokens).
//
//   SH-0001            → 2 tokens, article only
//   SH-0001-BK         → 3 tokens, variant with colour, no size
//   SH-0001-BK-40      → 4 tokens, full variant code
//   SH-0001-BK-40-XYZ  → null (malformed)
//   anything else      → null
export function parseVariantCode(input: string): ParsedVariantCode | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const parts = trimmed.split('-');
  if (parts.length < 2 || parts.length > 4) return null;
  // Every code starts with PREFIX-NNNN. The first two segments must be
  // non-empty — otherwise it's not a code we emitted.
  if (parts[0] === '' || parts[1] === '') return null;

  const internalCode = `${parts[0]}-${parts[1]}`;
  const colorPart = parts[2] ?? '';
  const sizePart = parts[3] ?? '';

  return {
    internalCode,
    colorPrefix: colorPart,
    size: sizePart,
    tokenCount: parts.length,
  };
}
