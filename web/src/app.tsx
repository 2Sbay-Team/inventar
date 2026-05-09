import { BrowserRouter, useRoutes } from 'react-router-dom';
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
    </BrowserRouter>
  );
}
