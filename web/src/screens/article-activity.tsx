import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { ScreenLayout } from '../components/screen-layout';
import { ActivityFeed } from '../components/activity-feed';
import { db } from '../db/db';
import { getArticle } from '../repos/articles';
import { listAllMovementsForArticle } from '../repos/movements';
import { sizeGridFor } from '../repos/quantity';
import { useLive } from '../hooks/use-live';
import { type Article, type Movement, type Variant } from '../types';
import { type SizeGridCell } from '../repos/quantity';

interface ActivityView {
  article: Article | null;
  sizes: SizeGridCell[];
  movements: Movement[];
}

export function ArticleActivityScreen(): JSX.Element {
  const { t } = useTranslation('article');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const view = useLive<ActivityView>(async () => {
    if (!id) return { article: null, sizes: [], movements: [] };
    const [article, sizes, movements] = await Promise.all([
      getArticle(db, id),
      sizeGridFor(db, id),
      listAllMovementsForArticle(db, id),
    ]);
    return { article: article ?? null, sizes, movements };
  }, [id]);

  const variantsById = useMemo(() => {
    const m = new Map<string, Variant>();
    if (!view?.article) return m;
    for (const cell of view.sizes) {
      m.set(cell.variant_id, {
        id: cell.variant_id,
        article_id: view.article.id,
        color: cell.color ?? null,
        photo_id: cell.photo_id,
        size: cell.size,
        hidden: cell.hidden,
        updated_at: '',
        deleted_at: null,
      });
    }
    return m;
  }, [view]);

  if (view === undefined)
    return (
      <ScreenLayout hideNav>
        <div />
      </ScreenLayout>
    );

  const { article, movements } = view;

  return (
    <ScreenLayout hideNav>
      <header className="border-hair flex items-center gap-3 border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="activity-back"
          onClick={() => navigate(`/article/${id ?? ''}`, { replace: true })}
          className="text-ink-2 -ml-1 p-1"
          aria-label={t('back_label')}
        >
          <ChevronLeft aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
        <h1 className="font-display text-ink flex-1 truncate text-base font-semibold">
          {article?.name ?? '…'}
        </h1>
      </header>

      <main
        data-testid="activity-screen"
        className="flex flex-1 flex-col overflow-y-auto px-5 py-4"
      >
        <h2 className="font-display text-ink-2 mb-3 text-[13px] font-medium">
          {t('activity_full_title')}
        </h2>
        {movements.length === 0 ? (
          <p className="text-ink-3 text-sm">{t('activity_empty')}</p>
        ) : (
          <ActivityFeed
            movements={movements}
            variantsById={variantsById}
            unitOfMeasure={article?.unit_of_measure ?? 'piece'}
          />
        )}
      </main>
    </ScreenLayout>
  );
}
