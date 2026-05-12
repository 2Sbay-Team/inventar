import { NavLink, useLocation } from 'react-router-dom';
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
  i18nKey: 'products' | 'sale' | 'reports' | 'settings';
  Icon: LucideIcon;
}

// v0.8 — tab targets now use the new canonical URLs (/products,
// /sale, /reports) and POS-standard testids (nav-products, nav-sale,
// nav-reports). Old testids (`nav-search`, `nav-sell`, `nav-dashboard`)
// were updated across ~8 e2e specs in the same commit; the route
// redirects ensure /list /add /sell /dashboard bookmarks still bounce
// to the new URLs.
const ITEMS: readonly NavItem[] = [
  { to: '/products', testId: 'nav-products', i18nKey: 'products', Icon: Package },
  { to: '/sale', testId: 'nav-sale', i18nKey: 'sale', Icon: Banknote },
  { to: '/reports', testId: 'nav-reports', i18nKey: 'reports', Icon: BarChart3 },
  { to: '/settings', testId: 'nav-settings', i18nKey: 'settings', Icon: SettingsIcon },
];

// v0.8 — the Products tab should highlight on EITHER `/` or
// `/products` because both URLs render the same SearchScreen
// (canonical is /products; / is an alias kept so internal
// `navigate('/')` calls don't redirect-flash through two history
// entries on every post-sale return / archive / delete). Other
// tabs use NavLink's default exact-match.
function isProductsActive(pathname: string): boolean {
  return pathname === '/' || pathname === '/products';
}

export function BottomNav(): JSX.Element {
  const { t } = useTranslation('nav');
  const location = useLocation();
  // v0.6.10 visual contract retained verbatim — see the comment in
  // commit 0eab392 for the full per-token rationale (z-100, blur 16,
  // shadow 0 -4px 20px, white/85, h-16, rounded-t-[20px], safe-area
  // padding-bottom). Only the tab list rotates with v0.7.
  return (
    <nav
      data-testid="bottom-nav"
      className="fixed inset-x-0 bottom-0 z-[100] flex h-16 justify-around bg-white/[0.85] backdrop-blur-[16px] shadow-[0_-4px_20px_rgba(0,0,0,0.06)] rounded-t-[20px] pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]"
    >
      {ITEMS.map(({ to, testId, i18nKey, Icon }) => {
        // Force-active override for the Products tab when on /
        // (the SearchScreen alias). NavLink's default isActive
        // checks against `to`, which would miss the `/` alias.
        const forceActive = to === '/products' && isProductsActive(location.pathname);
        return (
          <NavLink
            key={to}
            to={to}
            end
            data-testid={testId}
            className={({ isActive }) => {
              const active = isActive || forceActive;
              return [
                'group flex flex-1 flex-col items-center gap-0.5 py-1.5 transition-colors duration-200',
                active ? 'text-accent' : 'text-[#8E8E93] hover:text-ink-2',
              ].join(' ');
            }}
          >
            {({ isActive }) => {
              const active = isActive || forceActive;
              return (
                <>
                  <span
                    aria-hidden
                    data-state={active ? 'active' : 'inactive'}
                    data-testid={`${testId}-indicator`}
                    className="flex items-center justify-center rounded-2xl px-5 py-1 transition-all duration-200 data-[state=active]:bg-accent/[0.12] data-[state=active]:scale-[1.05] data-[state=inactive]:bg-transparent"
                  >
                    <Icon
                      aria-hidden
                      className="h-[18px] w-[18px] transition-[stroke-width] duration-200"
                      strokeWidth={active ? 2.5 : 1.5}
                    />
                  </span>
                  <span
                    className={[
                      'text-[10px] lowercase tracking-[0.04em] transition-all duration-200',
                      active ? 'font-semibold' : 'font-medium',
                    ].join(' ')}
                  >
                    {t(i18nKey)}
                  </span>
                </>
              );
            }}
          </NavLink>
        );
      })}
    </nav>
  );
}
