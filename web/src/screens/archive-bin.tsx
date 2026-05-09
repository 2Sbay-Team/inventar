import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenLayout } from '../components/screen-layout';
import { useLive } from '../hooks/use-live';
import { db } from '../db/db';
import { hardDeleteArticle, unarchiveArticle } from '../repos/articles';
import { type Article } from '../types';

async function listArchived(): Promise<Article[]> {
  return db.articles.filter((a) => a.archived_at !== null && a.deleted_at === null).toArray();
}

export function ArchiveBinScreen(): JSX.Element {
  const { t } = useTranslation('archive');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const archived = useLive<Article[]>(listArchived, [], []);

  return (
    <ScreenLayout hideNav>
      <header className="border-hair flex items-center justify-between border-b px-4 py-3">
        <button
          type="button"
          data-testid="archive-back"
          onClick={() => navigate(-1)}
          className="text-ink"
        >
          ←
        </button>
        <h3 className="font-display text-sm font-semibold">{t('title')}</h3>
        <span className="w-4" />
      </header>
      <main
        data-testid="archive-bin-screen"
        className="flex flex-1 flex-col gap-2 px-4 py-3 overflow-y-auto"
      >
        {archived.length === 0 ? (
          <p className="text-ink-3 text-center text-sm" data-testid="archive-empty">
            {t('empty')}
          </p>
        ) : (
          archived.map((a) => (
            <div
              key={a.id}
              data-testid="archived-row"
              className="border-hair flex items-center gap-2 rounded-xl border bg-white p-3"
            >
              <span className="font-display flex-1 text-sm">{a.name}</span>
              <button
                type="button"
                data-testid={`restore-${a.internal_code}`}
                onClick={() => void unarchiveArticle(db, a.id)}
                className="border-hair rounded-xl border px-3 py-1.5 text-xs"
              >
                {tCommon('restore')}
              </button>
              <button
                type="button"
                data-testid={`hard-delete-${a.internal_code}`}
                onClick={() => void hardDeleteArticle(db, a.id)}
                className="text-bad border-bad/30 rounded-xl border px-3 py-1.5 text-xs"
              >
                {tCommon('delete_forever')}
              </button>
            </div>
          ))
        )}
      </main>
    </ScreenLayout>
  );
}
