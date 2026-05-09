import { useTranslation } from 'react-i18next';
import { PhotoThumb } from './photo-thumb';
import { useProfile } from '../hooks/use-profile';
import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';

interface ShopHeaderProps {
  // Caller-provided counts so the header is reusable across screens that
  // already have the data; passing `undefined` hides the meta line.
  articles?: number | undefined;
  items?: number | undefined;
}

export function ShopHeader({ articles, items }: ShopHeaderProps): JSX.Element {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const profile = useProfile();
  const name = profile?.name ?? '';
  const logoId = profile?.logo_photo_id ?? null;
  const showMeta = articles !== undefined && items !== undefined;

  return (
    <header
      data-testid="shop-header"
      className="border-hair flex items-start justify-between border-b px-5 py-3"
    >
      <div className="flex items-center gap-3">
        {logoId ? (
          <PhotoThumb photoId={logoId} size={36} testId="shop-logo" className="rounded-full" />
        ) : null}
        <div>
          <h2
            data-testid="shop-name"
            className="font-display text-[19px] font-semibold tracking-tight text-ink"
          >
            {name}
          </h2>
          {showMeta ? (
            <div data-testid="shop-counts" className="text-ink-3 mt-1 font-mono text-[10.5px]">
              {t('header:articles_items', {
                articles: formatNumber(articles, locale),
                items: formatNumber(items, locale),
              })}
            </div>
          ) : null}
        </div>
      </div>
      <span
        data-testid="offline-pill"
        className="bg-ok-soft text-ok inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-medium"
      >
        <span className="bg-ok h-1.5 w-1.5 rounded-full" aria-hidden />
        {t('common:offline')}
      </span>
    </header>
  );
}
