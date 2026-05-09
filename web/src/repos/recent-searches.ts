import { type InventarDB } from '../db/db';
import { getMeta, META_KEYS, setMeta } from './meta';

// Recent-search chips on the Search screen. We keep the last three queries
// the user issued (after debounce), deduplicated. Stored under a dedicated
// meta key so it survives reloads but never leaves IndexedDB.

const MAX_RECENT = 3;

export async function getRecentSearches(db: InventarDB): Promise<string[]> {
  const value = await getMeta<unknown>(db, META_KEYS.recent_searches);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT);
}

export async function pushRecentSearch(db: InventarDB, query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return getRecentSearches(db);
  const current = await getRecentSearches(db);
  const next = [trimmed, ...current.filter((q) => q !== trimmed)].slice(0, MAX_RECENT);
  await setMeta(db, META_KEYS.recent_searches, next);
  return next;
}
