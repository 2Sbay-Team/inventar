import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

// Bottom nav, present on Search / List / Add / Dashboard / Settings.
// Active tab gets a soft cognac pill behind icon + label (mockup §1).

interface NavItem {
  to: string;
  testId: string;
  i18nKey: 'search' | 'list' | 'add' | 'dashboard' | 'settings';
  icon: string;
}

const ITEMS: readonly NavItem[] = [
  { to: '/', testId: 'nav-search', i18nKey: 'search', icon: '⌕' },
  { to: '/list', testId: 'nav-list', i18nKey: 'list', icon: '☰' },
  { to: '/add', testId: 'nav-add', i18nKey: 'add', icon: '＋' },
  { to: '/dashboard', testId: 'nav-dashboard', i18nKey: 'dashboard', icon: '◐' },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', icon: '⚙' },
];

export function BottomNav(): JSX.Element {
  const { t } = useTranslation('nav');
  return (
    <nav
      data-testid="bottom-nav"
      className="border-hair flex flex-shrink-0 justify-around border-t bg-white py-3 pb-5"
    >
      {ITEMS.map(({ to, testId, i18nKey, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          data-testid={testId}
          className={({ isActive }) =>
            [
              'flex flex-col items-center gap-1 rounded-full px-2.5 py-1.5 text-[9.5px] font-medium lowercase tracking-[0.04em]',
              isActive ? 'bg-accent-soft text-accent' : 'text-ink-3',
            ].join(' ')
          }
        >
          <span className="text-[18px] leading-none">{icon}</span>
          <span>{t(i18nKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
