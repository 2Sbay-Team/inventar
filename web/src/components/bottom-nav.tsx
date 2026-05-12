import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Banknote,
  Package,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';

// v0.7 ADR-037 — 4-tab unified bottom nav (Articles / Sell / Dashboard
// / Settings). The pre-v0.7 layout had two vertical-specific variants
// (ADD_ITEMS for fashion: Search + List + Add + Dashboard + Settings;
// SCAN_ITEMS for shop: Search + Receive + Sell + Dashboard + Settings)
// — merchants reported the duplication confusing (Search and List
// both lead to the article catalogue; Add tab overlapped with the FAB
// "+").
//
// New scheme — same tabs for every vertical:
//
//   Articles  →  /         (the article catalogue, formerly Search)
//   Sell      →  /sell     (shop scan flow today; fashion variant
//                            still TODO — Phase 2 of the brief)
//   Dashboard →  /dashboard
//   Settings  →  /settings
//
// Trade-offs with this rollout (Phase 3+4+5 of the brief):
//   • `nav-search` testid is preserved on the Articles tab so the
//     dozen e2e specs that click it still resolve without churn.
//   • /list and /add are still real routes — /list now redirects
//     to / (see routes.tsx), /add stays accessible for now via the
//     FAB on Articles and via deep links from onboarding. Renaming
//     /add to /articles/new lands with Phase 1 (Articles merge).
//   • /receive is no longer in the nav. Shop merchants reach it via
//     the article-detail screen's Restock action or a direct URL.
//     Restoring it as a nav tab would push us back to 5 tabs and
//     undo the simplification the brief is after.
//   • Fashion merchants who tap Sell land on the shop-flavoured
//     scan screen until Phase 2 ships the fashion-Sell variant.
//     The screen's "Type article name" fallback path works for them
//     but the camera-first prompt is suboptimal — documented.
//
// Icons follow the brief's mapping: Package (inventory), Banknote
// (money / sales), BarChart3 (analytics), Settings (cog). Active /
// inactive style + pill indicator + transitions are the v0.6.10
// modern-nav contract — unchanged here, only the tab list rotates.

interface NavItem {
  to: string;
  testId: string;
  i18nKey: 'articles' | 'sell' | 'dashboard' | 'settings';
  Icon: LucideIcon;
}

const ITEMS: readonly NavItem[] = [
  // testId stays `nav-search` on the Articles tab so the dozen e2e
  // specs that click it (locale-switch / backup-export / logo-render /
  // bottom-nav-pill / etc.) work without per-spec churn. Future
  // commit can rename to `nav-articles` once those specs are
  // touched anyway.
  { to: '/', testId: 'nav-search', i18nKey: 'articles', Icon: Package },
  { to: '/sell', testId: 'nav-sell', i18nKey: 'sell', Icon: Banknote },
  { to: '/dashboard', testId: 'nav-dashboard', i18nKey: 'dashboard', Icon: BarChart3 },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', Icon: SettingsIcon },
];

export function BottomNav(): JSX.Element {
  const { t } = useTranslation('nav');
  // v0.6.10 visual contract retained verbatim — see the comment in
  // commit 0eab392 for the full per-token rationale (z-100, blur 16,
  // shadow 0 -4px 20px, white/85, h-16, rounded-t-[20px], safe-area
  // padding-bottom). Only the tab list rotates with v0.7.
  return (
    <nav
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-[100] flex h-16 justify-around bg-white/[0.85] backdrop-blur-[16px] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] rounded-t-[20px] pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      {ITEMS.map(({ to, testId, i18nKey, Icon }) => (
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
