import { useLive } from './use-live';
import { db } from '../db/db';
import { getArticle } from '../repos/articles';
import { sizeGridFor, type SizeGridCell } from '../repos/quantity';
import { listRecentMovementsForArticle } from '../repos/movements';
import { type Article, type Movement, type UUID } from '../types';

export interface ArticleDetailView {
  article: Article | null;
  sizes: SizeGridCell[];
  recent: Movement[];
}

export function useArticleDetail(articleId: UUID | undefined): ArticleDetailView | undefined {
  return useLive<ArticleDetailView>(async () => {
    if (!articleId) return { article: null, sizes: [], recent: [] };
    const [article, sizes, recent] = await Promise.all([
      getArticle(db, articleId),
      sizeGridFor(db, articleId),
      listRecentMovementsForArticle(db, articleId, 8),
    ]);
    return { article: article ?? null, sizes, recent };
  }, [articleId]);
}
