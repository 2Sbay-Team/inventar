import { useTranslation } from 'react-i18next';

export function AppFooter(): JSX.Element {
  const { t } = useTranslation('common');
  return (
    <footer
      data-testid="app-footer"
      className="border-hair flex-shrink-0 border-t bg-white py-2 text-center"
    >
      <a
        href="https://hoodhood.ai/"
        target="_blank"
        rel="noopener noreferrer"
        className="text-ink-3 hover:text-accent text-[10px] font-medium tracking-wide transition-colors"
      >
        {t('powered_by')}
      </a>
    </footer>
  );
}
