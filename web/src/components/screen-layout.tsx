import { type ReactNode } from 'react';
import { AppFooter } from './app-footer';
import { BottomNav } from './bottom-nav';
import { Fab } from './fab';

interface ScreenLayoutProps {
  // The main content area; the layout adds the bottom nav and the standard
  // chrome around it. Screens that need a full bleed (modals) bypass this.
  children: ReactNode;
  // Set to true on Article detail / Add Article — those screens use their
  // own action bar at the bottom and should not show the bottom nav.
  hideNav?: boolean;
  // Set to true on content-heavy screens (e.g. Settings) to allow a
  // slightly wider column at desktop widths. Keeps all the phone/tablet
  // breakpoints unchanged — only the ≥1280px tier widens from 880→1120px.
  wide?: boolean;
}

// Outer wrapper paints the paper across the full viewport; the inner shell
// is centred and grows progressively with the viewport so the layout adapts
// to phones, tablets, and desktops without locking to a single phone-width
// column. Touch targets stay finger-sized at every step (we only widen the
// column, we don't downsize controls).
//
// Tiers — in sync with onboarding's main wrapper:
//   < 600px  : full-width (phone)
//   ≥ 600px  : 540px (small tablet / large phone landscape)
//   ≥ 768px  : 640px (tablet portrait)
//   ≥ 1024px : 768px (laptop / tablet landscape)
//   ≥ 1280px : 880px (desktop)  OR  1120px (desktop, wide=true)
export function ScreenLayout({ children, hideNav, wide }: ScreenLayoutProps): JSX.Element {
  // v0.6.8 — shell uses `h-[100dvh]` (dynamic viewport height) instead
  // of `min-h-screen` so the layout boundary stays at the visible
  // viewport edge even when inner content exceeds viewport. `min-h-0`
  // on the children flex container lets `flex-1` actually shrink so
  // the inner `<main overflow-y-auto>` engages.
  //
  // v0.6.9 — BottomNav now uses `position: fixed` and floats above the
  // shell. The shell's flex flow no longer reserves space for it,
  // which would cause the last article to slip behind the nav. The
  // children container takes `pb-[4rem+safe-area]` (64 px + the iOS
  // home-indicator inset) so visible content ends with a comfortable
  // gap above the nav's translucent backdrop. AppFooter still sits in
  // the flow below children — it's a small "powered by" credit and
  // landing behind the nav is acceptable; users don't need it
  // always-visible.
  const desktopMax = wide ? 'min-[1280px]:max-w-[1120px]' : 'min-[1280px]:max-w-[880px]';
  return (
    <div className="bg-paper flex min-h-screen w-full flex-col items-center">
      <div
        data-testid="app-shell"
        className={`border-hair relative flex h-[100dvh] w-full flex-col bg-paper min-[600px]:max-w-[540px] min-[600px]:border-x min-[600px]:shadow-sm min-[768px]:max-w-[640px] min-[1024px]:max-w-[768px] ${desktopMax}`}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col ${
            hideNav ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'
          }`}
        >
          {children}
        </div>
        <AppFooter />
        {hideNav ? null : <BottomNav />}
        {/* v0.6.4 — global FAB self-determines visibility per route
            (see web/src/components/fab.tsx). Mounted inside the shell
            so its `absolute end-6 bottom-X` positioning hugs the
            shell edge on wide viewports instead of the raw viewport. */}
        <Fab />
      </div>
    </div>
  );
}
