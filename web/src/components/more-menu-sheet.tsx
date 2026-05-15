import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { archiveArticle, hardDeleteArticle } from '../repos/articles';
import { type Article } from '../types';

interface MoreMenuSheetProps {
  open: boolean;
  article: Article;
  onClose: () => void;
  onArchived: () => void;
  onDeleted: () => void;
}

export function MoreMenuSheet({
  open,
  article,
  onClose,
  onArchived,
  onDeleted,
}: MoreMenuSheetProps): JSX.Element {
  const { t } = useTranslation('article');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  async function archive(): Promise<void> {
    await archiveArticle(db, article.id);
    onClose();
    onArchived();
  }

  async function deleteForever(): Promise<void> {
    await hardDeleteArticle(db, article.id);
    setDeleteOpen(false);
    onClose();
    onDeleted();
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30" />
          <Dialog.Content
            data-testid="more-menu-sheet"
            className="bg-paper fixed inset-x-0 bottom-0 rounded-t-3xl p-5 shadow-xl"
          >
            <Dialog.Title className="sr-only">{tCommon('edit')}</Dialog.Title>
            <ul className="flex flex-col gap-2">
              <li>
                <button
                  type="button"
                  data-testid="menu-print-labels"
                  onClick={() => {
                    onClose();
                    navigate(`/article/${article.id}/sheet`);
                  }}
                  className="border-hair w-full rounded-xl border bg-white px-4 py-3 text-start text-sm"
                >
                  {t('menu_print_labels')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="menu-archive"
                  onClick={() => void archive()}
                  className="border-hair w-full rounded-xl border bg-white px-4 py-3 text-start text-sm"
                >
                  {t('menu_archive')}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="menu-delete"
                  onClick={() => setDeleteOpen(true)}
                  className="border-bad/30 text-bad w-full rounded-xl border bg-white px-4 py-3 text-start text-sm"
                >
                  {t('menu_delete')}
                </button>
              </li>
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content
            data-testid="delete-confirm-sheet"
            className="bg-paper fixed inset-x-0 bottom-0 rounded-t-3xl p-5 shadow-xl"
          >
            <Dialog.Title className="font-display text-lg font-semibold">
              {t('delete_title')}
            </Dialog.Title>
            <p className="text-ink-2 mt-2 text-sm">{t('delete_body')}</p>
            <input
              data-testid="delete-confirm-input"
              type="text"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder={t('delete_placeholder')}
              className="border-hair mt-4 w-full rounded-xl border bg-white px-3 py-2 text-sm"
            />
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                data-testid="delete-cancel"
                onClick={() => setDeleteOpen(false)}
                className="border-hair flex-1 rounded-xl border bg-white py-3 text-sm"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                data-testid="delete-confirm"
                disabled={deleteText !== 'DELETE'}
                onClick={() => void deleteForever()}
                className="bg-bad flex-1 rounded-xl py-3 text-sm text-white disabled:opacity-50"
              >
                {tCommon('delete_forever')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
