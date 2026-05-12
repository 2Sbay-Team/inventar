import { useEffect } from 'react';
import { BrowserRouter, useRoutes } from 'react-router-dom';
import { AppUpdateModal } from './components/app-update-modal';
import { AppUpdateToast } from './components/app-update-toast';
import { useAutoBackup } from './hooks/use-auto-backup';
import { useProfile } from './hooks/use-profile';
import { routes } from './routes';
import { applyTheme } from './theme/apply-theme';

function AppRoutes(): JSX.Element | null {
  // Tied to the lifetime of the app. The hook is a no-op when no
  // auto-backup folder is configured, so this is safe to mount globally.
  useAutoBackup();
  return useRoutes(routes);
}

// v0.9 ADR-040 — push the merchant's brand + bg colours onto :root any
// time the profile changes. When both are null (the default), this
// removes any inline override so the CSS :root defaults in index.css
// keep their pre-v0.9 hex values — visually identical to v0.8.x.
function ThemeApplier(): null {
  const profile = useProfile();
  useEffect(() => {
    // `undefined` = still loading the profile from Dexie; defer the
    // apply until we know whether the merchant has overrides. `null`
    // = onboarding not done; treat as "no overrides" so the
    // onboarding screens render with the default palette.
    if (profile === undefined) return;
    applyTheme(profile);
  }, [profile]);
  return null;
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      {/* v0.9 ADR-040 — mounted above the routes so the theme is in
          place before any screen renders. */}
      <ThemeApplier />
      <AppRoutes />
      {/* v0.6 ADR-031 — overlay siblings of the router so the update
          consent modal + post-reload toast render on top of any
          screen. AppUpdateModal is blocking when active; AppUpdateToast
          is a 4-second auto-dismiss. */}
      <AppUpdateModal />
      <AppUpdateToast />
    </BrowserRouter>
  );
}
