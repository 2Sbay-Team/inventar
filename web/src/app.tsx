import { BrowserRouter, useRoutes } from 'react-router-dom';
import { routes } from './routes';

function AppRoutes(): JSX.Element | null {
  return useRoutes(routes);
}

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
