import { type Locale } from '../types';

// v0.6 ADR-030 — fetch the *new* whats-new.json that ships with the
// waiting SW. We cache-bust the URL so the active SW's precache (which
// holds the OLD whats-new.json) doesn't intercept; the request falls
// through to the network and we get the freshly-deployed file.
//
// Offline (no network, no cached match for the cache-busted URL) the
// fetch fails — caller falls back to a generic "improvements and bug
// fixes" copy per the v0.6 brief.

export interface WhatsNew {
  version: string;
  released_at: string;
  highlights: Record<Locale, readonly string[]>;
}

export function isValidWhatsNew(input: unknown): input is WhatsNew {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  if (typeof obj.version !== 'string' || obj.version.trim() === '') return false;
  if (typeof obj.released_at !== 'string') return false;
  const hl = obj.highlights;
  if (!hl || typeof hl !== 'object') return false;
  const hlObj = hl as Record<string, unknown>;
  for (const locale of ['en', 'fr', 'ar'] as const) {
    const arr = hlObj[locale];
    if (!Array.isArray(arr)) return false;
    if (!arr.every((s) => typeof s === 'string')) return false;
  }
  return true;
}

export async function fetchWhatsNew(): Promise<WhatsNew | null> {
  try {
    // Cache-busting query string forces the request past workbox's
    // exact-URL precache match.
    const res = await fetch(`/whats-new.json?_=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return isValidWhatsNew(json) ? json : null;
  } catch (err) {
    console.warn('[fetch-whats-new] failed', err);
    return null;
  }
}
