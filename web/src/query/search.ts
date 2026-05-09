import { db as appDB, type InventarDB } from '../db/db';
import { quantityFor } from '../repos/quantity';
import { type Article, type Variant } from '../types';
import { type ParsedQuery, parseQuery } from './parse-query';

// SPEC §2.2 — load candidate articles, filter by token match, then rank.
// At MVP scale (≤ 500 articles, ~50 KB total search_blob) an in-memory pass
// is well below the 200 ms target without exotic indexing tricks.
//
// Ranking tiers (highest first):
//   1. exact-size match in stock
//   2. exact-size match out-of-stock
//   3. partial match (no size token, or size variant doesn't exist)
//   4. archived (always last)
// Ties broken alphabetically on article.name.

export interface SizeStock {
  // Null for sizeless store types (kiosk / grocery) — stock-by-size UI is
  // hidden in that case so the consumer never reads the null.
  size: string | null;
  qty: number;
}

export interface SearchResult {
  article: Article;
  // Variants live alongside the article so result cards can render the
  // stock-badge text without a second round-trip.
  variants: Variant[];
  // Quantity per non-deleted, non-hidden variant — same shape as sizeGridFor
  // but flat. Sorted by size for deterministic UI.
  sizeStock: SizeStock[];
  // Total in-stock count across all variants.
  totalQty: number;
  // The size token from the user's query that matched a variant exactly, if
  // any; populated by ranking. Drives the in-stock-vs-out badge.
  matchedSize: string | null;
  // Whether the article is archived (still surfaced, just last in order).
  archived: boolean;
}

export interface SearchOptions {
  // Show archived articles too. Default false — Settings → Archive bin uses
  // an explicit listing instead of the search screen.
  includeArchived?: boolean;
  // Cap on returned results. Search screen renders all of them, but the
  // type-ahead path may cap to e.g. 50 to keep the list snappy.
  limit?: number;
}

interface ArticleWithIndex {
  article: Article;
  variants: Variant[];
}

async function loadCandidateArticles(
  db: InventarDB,
  includeArchived: boolean,
): Promise<ArticleWithIndex[]> {
  const articles = await db.articles
    .filter((a) => a.deleted_at === null && (includeArchived || a.archived_at === null))
    .toArray();
  if (articles.length === 0) return [];
  const ids = new Set(articles.map((a) => a.id));
  const allVariants = await db.variants
    .filter((v) => v.deleted_at === null && !v.hidden && ids.has(v.article_id))
    .toArray();
  const byArticle = new Map<string, Variant[]>();
  for (const v of allVariants) {
    const arr = byArticle.get(v.article_id);
    if (arr) arr.push(v);
    else byArticle.set(v.article_id, [v]);
  }
  return articles.map((article) => ({
    article,
    variants: (byArticle.get(article.id) ?? [])
      .slice()
      .sort((a, b) => (a.size ?? '').localeCompare(b.size ?? '', undefined, { numeric: true })),
  }));
}

function articleMatchesGeneralTokens(blob: string, parsed: ParsedQuery): boolean {
  for (const group of parsed.generalTokens) {
    const hit = group.some((alias) => blob.includes(alias));
    if (!hit) return false;
  }
  return true;
}

async function buildSizeStock(
  db: InventarDB,
  variants: Variant[],
): Promise<{ stock: SizeStock[]; total: number }> {
  const stock: SizeStock[] = await Promise.all(
    variants.map(async (v) => ({ size: v.size, qty: await quantityFor(db, v.id) })),
  );
  const total = stock.reduce((s, c) => s + Math.max(0, c.qty), 0);
  return { stock, total };
}

// Tier-based score: higher is better. matchedSize / archived computed too.
function rankResult(
  parsed: ParsedQuery,
  stock: SizeStock[],
  archived: boolean,
): { score: number; matchedSize: string | null } {
  if (archived) return { score: 0, matchedSize: null };

  // Find the highest-priority size match across user's size tokens.
  let matchedInStock: string | null = null;
  let matchedOutOfStock: string | null = null;
  for (const sz of parsed.sizeTokens) {
    const cell = stock.find((c) => c.size === sz);
    if (!cell) continue;
    if (cell.qty > 0) {
      matchedInStock = sz;
      break;
    }
    if (matchedOutOfStock === null) matchedOutOfStock = sz;
  }
  if (matchedInStock) return { score: 3, matchedSize: matchedInStock };
  if (matchedOutOfStock) return { score: 2, matchedSize: matchedOutOfStock };
  return { score: 1, matchedSize: null };
}

export async function searchArticles(
  rawQuery: string,
  options: SearchOptions = {},
  db: InventarDB = appDB,
): Promise<SearchResult[]> {
  const parsed = parseQuery(rawQuery);
  const includeArchived = options.includeArchived ?? false;
  const candidates = await loadCandidateArticles(db, includeArchived);

  // Empty query → list all candidates ranked by recency. Drives the empty
  // SearchScreen and any "suggestion" surfaces that want a default ordering.
  const matches = parsed.isEmpty
    ? candidates
    : candidates.filter(({ article }) => articleMatchesGeneralTokens(article.search_blob, parsed));

  const enriched: SearchResult[] = await Promise.all(
    matches.map(async ({ article, variants }) => {
      const { stock, total } = await buildSizeStock(db, variants);
      const archived = article.archived_at !== null;
      const { score, matchedSize } = rankResult(parsed, stock, archived);
      return {
        article,
        variants,
        sizeStock: stock,
        totalQty: total,
        matchedSize,
        archived,
        // attach score on the runtime object via a non-public field; we
        // strip it before returning.
        _score: score,
      } as SearchResult & { _score: number };
    }),
  );

  enriched.sort((a, b) => {
    const sa = (a as SearchResult & { _score: number })._score;
    const sb = (b as SearchResult & { _score: number })._score;
    if (sa !== sb) return sb - sa;
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    // Recency tiebreak: newer updated_at first.
    if (a.article.updated_at !== b.article.updated_at) {
      return a.article.updated_at < b.article.updated_at ? 1 : -1;
    }
    return a.article.name.localeCompare(b.article.name);
  });

  const cleaned: SearchResult[] = enriched.map(
    ({ article, variants, sizeStock, totalQty, matchedSize, archived }) => ({
      article,
      variants,
      sizeStock,
      totalQty,
      matchedSize,
      archived,
    }),
  );

  return options.limit ? cleaned.slice(0, options.limit) : cleaned;
}
