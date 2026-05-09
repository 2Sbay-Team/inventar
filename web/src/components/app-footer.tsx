import { useTranslation } from 'react-i18next';

export function AppFooter(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <footer
      data-testid="app-footer"
      className="border-hair flex-shrink-0 border-t bg-white py-2 text-center"
    >
      <span className="text-ink-3 text-[10px] font-medium tracking-wide">{t('powered_by')}</span>
    </footer>
  );
}
