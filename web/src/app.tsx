import { BrowserRouter, useRoutes } from 'react-router-dom';
import { AppUpdateModal } from './components/app-update-modal';
import { AppUpdateToast } from './components/app-update-toast';
import { useAutoBackup } from './hooks/use-auto-backup';
import { routes } from './routes';

function AppRoutes(): JSX.Element | null {
  // Tied to the lifetime of the app. The hook is a no-op when no
  // auto-backup folder is configured, so this is safe to mount globally.
  useAutoBackup();
  return useRoutes(routes);
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRoutes />
      {/* v0.6 ADR-030 — overlay siblings of the router so the update
          consent modal + post-reload toast render on top of any
          screen. AppUpdateModal is blocking when active; AppUpdateToast
          is a 4-second auto-dismiss. */}
      <AppUpdateModal />
      <AppUpdateToast />
    </BrowserRouter>
  );
}
