import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { useProfile } from './hooks/use-profile';

// Each screen is loaded on demand so the initial bundle only ships the search
// route. The wrapper plucks the named export (screens use named exports for
// clarity) into the default slot React.lazy expects.
const OnboardingScreen = lazy(() =>
  import('./screens/onboarding').then((m) => ({ default: m.OnboardingScreen })),
);
const SearchScreen = lazy(() =>
  import('./screens/search').then((m) => ({ default: m.SearchScreen })),
);
// v0.8 — ListScreen is no longer routed. /list redirects to /products,
// which serves SearchScreen. The lazy import stays in the codebase
// (Phase 1 will merge the two screens) but no longer in this file.
const AddArticleScreen = lazy(() =>
  import('./screens/add-article').then((m) => ({ default: m.AddArticleScreen })),
);
const DashboardScreen = lazy(() =>
  import('./screens/dashboard').then((m) => ({ default: m.DashboardScreen })),
);
const SettingsScreen = lazy(() =>
  import('./screens/settings').then((m) => ({ default: m.SettingsScreen })),
);
const ArchiveBinScreen = lazy(() =>
  import('./screens/archive-bin').then((m) => ({ default: m.ArchiveBinScreen })),
);
const ArticleDetailScreen = lazy(() =>
  import('./screens/article-detail').then((m) => ({ default: m.ArticleDetailScreen })),
);
const ArticleLabelScreen = lazy(() =>
  import('./screens/article-label').then((m) => ({ default: m.ArticleLabelScreen })),
);
const LabelPreviewScreen = lazy(() =>
  import('./screens/label-preview').then((m) => ({ default: m.LabelPreviewScreen })),
);
const InvoiceViewScreen = lazy(() =>
  import('./screens/invoice-view').then((m) => ({ default: m.InvoiceViewScreen })),
);
const InvoicesListScreen = lazy(() =>
  import('./screens/invoices-list').then((m) => ({ default: m.InvoicesListScreen })),
);
const HelpScreen = lazy(() => import('./screens/help').then((m) => ({ default: m.HelpScreen })));
const StockReportScreen = lazy(() =>
  import('./screens/stock-report').then((m) => ({ default: m.StockReportScreen })),
);
const ReceiveScreen = lazy(() =>
  import('./screens/receive').then((m) => ({ default: m.ReceiveScreen })),
);
const SellScreen = lazy(() => import('./screens/sell').then((m) => ({ default: m.SellScreen })));
// v0.5.2 ADR-018: ExpiryScreen is no longer routed directly — the
// /expiry route redirects to /alerts?tab=expiring. Kept lazy-importable
// so that AlertsScreen (which embeds it as Tab 2) can still load it.
const AlertsScreen = lazy(() =>
  import('./screens/alerts').then((m) => ({ default: m.AlertsScreen })),
);
const ConfirmSubtypesScreen = lazy(() =>
  import('./screens/migrations/confirm-subtypes').then((m) => ({
    default: m.ConfirmSubtypesScreen,
  })),
);

// Onboarding gate. SPEC §2.1: a user without a ShopProfile row must complete
// onboarding before any other screen renders. The gate also protects against
// race conditions on a fresh install where the profile query hasn't resolved
// yet — we show nothing until the answer arrives.
function OnboardingGate({ children }: { children: ReactNode }): JSX.Element | null {
  const profile = useProfile();
  if (profile === undefined) return null; // still loading
  if (profile === null) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

// Inverse gate: the onboarding screen should redirect away once a profile
// exists. Prevents the user from re-entering it via back navigation.
function OnboardingOnly({ children }: { children: ReactNode }): JSX.Element | null {
  const profile = useProfile();
  if (profile === undefined) return null;
  if (profile !== null) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Suspense fallback is intentionally null — chunks load fast on a warm cache,
// and a flash of spinner during route changes is more disruptive than a brief
// blank frame. The OnboardingGate already returns null while the profile
// query resolves, so users never see uninitialised state.
function Lazy({ children }: { children: ReactNode }): JSX.Element {
  return <Suspense fallback={null}>{children}</Suspense>;
}

export const routes: RouteObject[] = [
  {
    path: '/onboarding',
    element: (
      <Lazy>
        <OnboardingOnly>
          <OnboardingScreen />
        </OnboardingOnly>
      </Lazy>
    ),
  },
  // v0.8 — canonical routes are now /products, /sale, /reports (per
  // the POS-naming brief). The old paths (/, /list, /add, /sell,
  // /dashboard) remain reachable: / is a SearchScreen alias (kept
  // because nine internal `navigate('/')` call sites use it as the
  // "home" shorthand — flipping it to a Navigate redirect adds a
  // double-history flash on every onboarding completion / archive /
  // delete / post-sale return); the others are <Navigate> redirects
  // so bookmarks bounce to the new URLs.
  //
  // Phase 1 of the brief (merge Search + List into a real
  // /products screen with sort chips + show-archived) and Phase 2
  // (new fashion-flavoured Sale screen with quick-sell + recents
  // + 3-tap variant flow) are deferred to follow-up sessions; for
  // now /products renders the existing SearchScreen, /sale renders
  // the existing SellScreen, /reports renders DashboardScreen.

  {
    path: '/',
    element: (
      <Lazy>
        <OnboardingGate>
          <SearchScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.8 — canonical Products route. Same SearchScreen as / for
    // now; Phase 1 swaps in the merged Search+List component here.
    path: '/products',
    element: (
      <Lazy>
        <OnboardingGate>
          <SearchScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // Old /list bookmarks bounce to the new canonical.
    path: '/list',
    element: <Navigate to="/products" replace />,
  },
  {
    // v0.8 — Add-product route under the new namespace.
    path: '/products/new',
    element: (
      <Lazy>
        <OnboardingGate>
          <AddArticleScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // Old /add bookmarks + the FAB's legacy target bounce here.
    path: '/add',
    element: <Navigate to="/products/new" replace />,
  },
  {
    path: '/article/:id',
    element: (
      <Lazy>
        <OnboardingGate>
          <ArticleDetailScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.5.2.3 — printable QR-label sheet for an article. Lands here
    // automatically right after Add Article saves, and reachable via
    // the Print Label action inside the QR dialog on Article Detail.
    path: '/article/:id/label',
    element: (
      <Lazy>
        <OnboardingGate>
          <ArticleLabelScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.5.2.4 ADR-024 — printable Facture view. /sell lands here
    // when the merchant ticked "Generate invoice" in the cart drawer.
    // Browse to past invoices later via Settings → Past invoices
    // (added in commit 3).
    path: '/invoice/:id',
    element: (
      <Lazy>
        <OnboardingGate>
          <InvoiceViewScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.5.2.4 ADR-024 — Past invoices list, reachable from Settings.
    path: '/invoices',
    element: (
      <Lazy>
        <OnboardingGate>
          <InvoicesListScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.8 — canonical Reports route. Same DashboardScreen content
    // for now; Phase 3 of the brief renamed the route only.
    path: '/reports',
    element: (
      <Lazy>
        <OnboardingGate>
          <DashboardScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // Old /dashboard bookmarks bounce to /reports.
    path: '/dashboard',
    element: <Navigate to="/reports" replace />,
  },
  {
    path: '/settings',
    element: (
      <Lazy>
        <OnboardingGate>
          <SettingsScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    path: '/settings/archive',
    element: (
      <Lazy>
        <OnboardingGate>
          <ArchiveBinScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.6 ADR-030 — Settings → Preview label. Renders a stub QR label
    // so the merchant can see how their logo / store name will look on
    // a printed sheet before they print a real article's label.
    path: '/settings/label-preview',
    element: (
      <Lazy>
        <OnboardingGate>
          <LabelPreviewScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    path: '/help',
    element: (
      <Lazy>
        <OnboardingGate>
          <HelpScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    path: '/stock-report',
    element: (
      <Lazy>
        <OnboardingGate>
          <StockReportScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.5 ADR-018: scan-driven receiving. Primary entry for shop
    // merchants (replaces Add in the bottom nav). Other verticals can
    // still navigate to /receive directly if they have barcoded items,
    // but the screen is shop-shaped (sizeless / colourless mini-form).
    path: '/receive',
    element: (
      <Lazy>
        <OnboardingGate>
          <ReceiveScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.8 — canonical Sale route. Existing SellScreen renders here
    // for now (the v0.5 ADR-018 scan-driven cart + invoice flow);
    // Phase 2 of the brief swaps in a fashion-flavoured variant with
    // quick-sell cards, recent-sales feed, and 3-tap variant flow.
    path: '/sale',
    element: (
      <Lazy>
        <OnboardingGate>
          <SellScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // Old /sell bookmarks bounce to /sale.
    path: '/sell',
    element: <Navigate to="/sale" replace />,
  },
  {
    // v0.5.2 ADR-018: consolidated alerts screen with two tabs.
    // Replaces the standalone /expiry as the canonical entry point
    // for both stock-low and expiring-soon notifications.
    path: '/alerts',
    element: (
      <Lazy>
        <OnboardingGate>
          <AlertsScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    // v0.5.2: legacy /expiry route → permanent redirect to the
    // expiring tab of /alerts. Preserves any external bookmarks /
    // deep links from pre-v0.5.2 installs.
    path: '/expiry',
    element: <Navigate to="/alerts?tab=expiring" replace />,
  },
  {
    // v0.5.2 ADR-021: one-time post-migration confirmation. The
    // ConfirmSubtypesScreen self-redirects to / if either no
    // migration ran or the merchant already confirmed.
    path: '/migrations/confirm-subtypes',
    element: (
      <Lazy>
        <OnboardingGate>
          <ConfirmSubtypesScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  { path: '*', element: <Navigate to="/" replace /> },
];
