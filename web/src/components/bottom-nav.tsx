import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  LayoutGrid,
  Plus,
  ScanLine,
  Search as SearchIcon,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { useProfile } from '../hooks/use-profile';
import { STORE_TYPES } from '../config/store-types';

// Bottom nav, present on Search / List / Add / Dashboard / Settings.
// Active tab gets a soft accent pill behind icon + label.
//
// v0.5 ADR-018: when the active store_type's primary_flow is 'scan'
// (currently only 'shop'), the Add slot is replaced by Receive.
// Merchants in scan-first verticals reach Add Article through
// /receive's manual fallback when they need a non-barcoded item.

interface NavItem {
  to: string;
  testId: string;
  i18nKey: 'search' | 'list' | 'add' | 'dashboard' | 'settings' | 'receive';
  Icon: LucideIcon;
}

const ADD_ITEMS: readonly NavItem[] = [
  { to: '/', testId: 'nav-search', i18nKey: 'search', Icon: SearchIcon },
  { to: '/list', testId: 'nav-list', i18nKey: 'list', Icon: LayoutGrid },
  { to: '/add', testId: 'nav-add', i18nKey: 'add', Icon: Plus },
  { to: '/dashboard', testId: 'nav-dashboard', i18nKey: 'dashboard', Icon: LayoutDashboard },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', Icon: SettingsIcon },
];

const SCAN_ITEMS: readonly NavItem[] = [
  { to: '/', testId: 'nav-search', i18nKey: 'search', Icon: SearchIcon },
  { to: '/list', testId: 'nav-list', i18nKey: 'list', Icon: LayoutGrid },
  { to: '/receive', testId: 'nav-receive', i18nKey: 'receive', Icon: ScanLine },
  { to: '/dashboard', testId: 'nav-dashboard', i18nKey: 'dashboard', Icon: LayoutDashboard },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', Icon: SettingsIcon },
];

export function BottomNav(): JSX.Element {
  const { t } = useTranslation('nav');
  const profile = useProfile();
  const storeType = profile?.store_type ?? 'shoes';
  const isScanFirst = STORE_TYPES[storeType].primary_flow === 'scan';
  const items = isScanFirst ? SCAN_ITEMS : ADD_ITEMS;
  return (
    <nav
      data-testid="bottom-nav"
      className="border-hair flex flex-shrink-0 justify-around border-t bg-white py-3 pb-5"
    >
      {items.map(({ to, testId, i18nKey, Icon }) => (
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
          <Icon aria-hidden className="h-[18px] w-[18px]" strokeWidth={2.25} />
          <span>{t(i18nKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
