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
        className="text-ink-3 hover:text-accent inline-flex items-center gap-1.5 text-[10px] font-medium tracking-wide transition-colors"
      >
        <img
          src="/hoodhood-logo.png"
          alt=""
          aria-hidden
          width={14}
          height={14}
          className="h-3.5 w-3.5 rounded-sm object-contain"
        />
        <span>{t('powered_by')}</span>
      </a>
    </footer>
  );
}
