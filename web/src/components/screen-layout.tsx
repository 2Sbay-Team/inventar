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
  // Set to true on task/print screens to suppress the AppFooter brand chrome.
  // Critical for print screens (article-label, invoice-view, label-sheet)
  // where the footer would appear on physical labels given to customers.
  hideFooter?: boolean;
  // Wider desktop shell for dense screens like Settings. Default stays the
  // original mobile-first max-width so product/sale/report screens are not
  // changed by this polish pass.
  wide?: boolean;
}

export function ScreenLayout({
  children,
  hideNav,
  hideFooter,
  wide = false,
}: ScreenLayoutProps): JSX.Element {
  const desktopMaxWidth = wide ? 'min-[1280px]:max-w-[1120px]' : 'min-[1280px]:max-w-[880px]';

  return (
    <div className="bg-paper flex min-h-screen w-full flex-col items-center">
      <div
        data-testid="app-shell"
        className={`border-hair relative flex h-[100dvh] w-full flex-col bg-paper min-[600px]:max-w-[540px] min-[600px]:border-x min-[600px]:shadow-sm min-[768px]:max-w-[640px] min-[1024px]:max-w-[768px] ${desktopMaxWidth}`}
      >
        <div
          className={`flex min-h-0 flex-1 flex-col ${
            hideNav ? '' : 'pb-[calc(4rem+env(safe-area-inset-bottom))]'
          }`}
        >
          {children}
        </div>
        {hideFooter ? null : <AppFooter />}
        {hideNav ? null : <BottomNav />}
        <Fab />
      </div>
    </div>
  );
}
