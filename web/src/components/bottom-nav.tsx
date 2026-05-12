import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  LayoutGrid,
  Plus,
  ScanLine,
  Search as SearchIcon,
  Settings as SettingsIcon,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { useProfile } from '../hooks/use-profile';
import { STORE_TYPES } from '../config/store-types';

// Bottom nav, present on Search / List / Add / Dashboard / Settings.
//
// v0.5 ADR-018: when the active store_type's primary_flow is 'scan'
// (currently only 'shop'), the Add and List slots are replaced by
// Receive and Sell — the two scan-driven flows. Merchants in scan-first
// verticals can still reach List + Add Article via direct URL or via
// /receive's manual fallback.
//
// v0.6.9 — visual refresh + literal `position: fixed`. The v0.6.8 fix
// (h-dvh shell) already pinned the nav to the visible viewport on long
// catalogues, but the visual remained flat and the literal CSS positioning
// stayed flow-based. This rewrite goes the textbook route: rounded top
// corners, backdrop blur, soft shadow, active-tab pill indicator. Each
// tab transitions between active and inactive states in 200 ms (icon
// stroke weight + colour, label weight, pill background). Stroke-width
// difference (1.5 inactive → 2.5 active) doubles as a fallback for
// Lucide's lack of filled-icon variants.
//
// v0.6.10 — nudged the seven cosmetic values to the original brief's
// exact spec after merchant review: z-100 (was z-50), backdrop-blur 16
// (was 12 / md), shadow `0 -4px 20px` (was `0 -2px 16px`),
// background-alpha 0.85 (was 0.92), explicit height 64 px (was implicit
// ~62), active/inactive stroke 2.5/1.5 (was 2.25/1.75), inactive colour
// #8E8E93 (was theme `text-ink-3`).

interface NavItem {
  to: string;
  testId: string;
  i18nKey: 'search' | 'list' | 'add' | 'dashboard' | 'settings' | 'receive' | 'sell';
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
  { to: '/receive', testId: 'nav-receive', i18nKey: 'receive', Icon: ScanLine },
  { to: '/sell', testId: 'nav-sell', i18nKey: 'sell', Icon: ShoppingCart },
  { to: '/dashboard', testId: 'nav-dashboard', i18nKey: 'dashboard', Icon: LayoutDashboard },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', Icon: SettingsIcon },
];

export function BottomNav(): JSX.Element {
  const { t } = useTranslation('nav');
  const profile = useProfile();
  const storeType = profile?.store_type ?? 'shoes';
  const isScanFirst = STORE_TYPES[storeType].primary_flow === 'scan';
  const items = isScanFirst ? SCAN_ITEMS : ADD_ITEMS;
  // Visual contract (values to the brief's exact spec):
  //   • Container: fixed at viewport bottom, rounded top corners (20 px),
  //     translucent white (0.85 alpha) with backdrop-blur(16 px), soft
  //     upward shadow `0 -4px 20px rgba(0,0,0,0.06)`, explicit height
  //     64 px (h-16) above the safe-area padding.
  //   • Active tab: pill indicator (bg-accent at 12 % alpha), accent-
  //     coloured icon at stroke-width 2.5, accent-coloured label at
  //     semi-bold weight, icon scale 1.05.
  //   • Inactive tab: gray (#8E8E93) icon at stroke-width 1.5, regular-
  //     medium label, no pill background. Transitions over 200 ms.
  //   • Safe-area aware: padding-bottom honours env(safe-area-inset-bottom)
  //     so iOS notched home-indicator doesn't bisect the labels.
  //
  // z-[100] sits above page content (z-auto), the FAB (z-30), and below
  // Radix dialog overlays (default z-50 — wait, Radix uses inset-0 on
  // the overlay which covers the nav regardless of z-ordering, so the
  // blocking-modal interaction stays correct even at z-100).
  return (
    <nav
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-[100] flex h-16 justify-around bg-white/[0.85] backdrop-blur-[16px] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] rounded-t-[20px] pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      {items.map(({ to, testId, i18nKey, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          data-testid={testId}
          className={({ isActive }) =>
            [
              'group flex flex-1 flex-col items-center gap-0.5 py-1.5 transition-colors duration-200',
              isActive ? 'text-accent' : 'text-[#8E8E93] hover:text-ink-2',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              {/* Pill indicator wraps the icon. data-state drives the
                  Tailwind data-attribute selectors so transitions on
                  background, scale, and stroke land in lockstep. */}
              <span
                aria-hidden
                data-state={isActive ? 'active' : 'inactive'}
                data-testid={`${testId}-indicator`}
                className="flex items-center justify-center rounded-2xl px-5 py-1 transition-all duration-200 data-[state=active]:bg-accent/[0.12] data-[state=active]:scale-[1.05] data-[state=inactive]:bg-transparent"
              >
                <Icon
                  aria-hidden
                  className="h-[18px] w-[18px] transition-[stroke-width] duration-200"
                  strokeWidth={isActive ? 2.5 : 1.5}
                />
              </span>
              <span
                className={[
                  'text-[10px] lowercase tracking-[0.04em] transition-all duration-200',
                  isActive ? 'font-semibold' : 'font-medium',
                ].join(' ')}
              >
                {t(i18nKey)}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
