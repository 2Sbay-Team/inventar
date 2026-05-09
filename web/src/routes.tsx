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
const ListScreen = lazy(() => import('./screens/list').then((m) => ({ default: m.ListScreen })));
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
    path: '/list',
    element: (
      <Lazy>
        <OnboardingGate>
          <ListScreen />
        </OnboardingGate>
      </Lazy>
    ),
  },
  {
    path: '/add',
    element: (
      <Lazy>
        <OnboardingGate>
          <AddArticleScreen />
        </OnboardingGate>
      </Lazy>
    ),
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
    path: '/dashboard',
    element: (
      <Lazy>
        <OnboardingGate>
          <DashboardScreen />
        </OnboardingGate>
      </Lazy>
    ),
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
  { path: '*', element: <Navigate to="/" replace /> },
];
