import { type ReactNode } from 'react';
import { BottomNav } from './bottom-nav';

interface ScreenLayoutProps {
  // The main content area; the layout adds the bottom nav and the standard
  // chrome around it. Screens that need a full bleed (modals) bypass this.
  children: ReactNode;
  // Set to true on Article detail / Add Article — those screens use their
  // own action bar at the bottom and should not show the bottom nav.
  hideNav?: boolean;
}

// Outer wrapper paints the warm paper across the full viewport; the inner
// shell is centred and capped at 480px above the 600px breakpoint, full-width
// below. The bottom nav lives inside the shell so it stays aligned.
export function ScreenLayout({ children, hideNav }: ScreenLayoutProps): JSX.Element {
  return (
    <div className="bg-paper flex min-h-screen w-full flex-col items-center">
      <div
        data-testid="app-shell"
        className="border-hair relative flex min-h-screen w-full flex-col bg-paper min-[600px]:max-w-[480px] min-[600px]:border-x min-[600px]:shadow-sm"
      >
        <div className="flex flex-1 flex-col">{children}</div>
        {hideNav ? null : <BottomNav />}
      </div>
    </div>
  );
}
