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
//   ≥ 1280px : 880px (desktop)
export function ScreenLayout({ children, hideNav }: ScreenLayoutProps): JSX.Element {
  return (
    <div className="bg-paper flex min-h-screen w-full flex-col items-center">
      <div
        data-testid="app-shell"
        className="border-hair relative flex min-h-screen w-full flex-col bg-paper min-[600px]:max-w-[540px] min-[600px]:border-x min-[600px]:shadow-sm min-[768px]:max-w-[640px] min-[1024px]:max-w-[768px] min-[1280px]:max-w-[880px]"
      >
        <div className="flex flex-1 flex-col">{children}</div>
        <AppFooter />
        {hideNav ? null : <BottomNav />}
        {/* v0.6.4 — global FAB self-determines visibility per route
            (see web/src/components/fab.tsx). Mounted inside the shell
            so its `absolute end-6 bottom-20` positioning hugs the
            shell edge on wide viewports instead of the raw viewport. */}
        <Fab />
      </div>
    </div>
  );
}
