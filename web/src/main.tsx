import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { ErrorBoundary } from './components/error-boundary';
import './styles/index.css';
import { initI18n } from './i18n/i18next';
import { registerServiceWorker } from './pwa/register-sw';
import { ensurePersistence } from './pwa/persistence';
import { db } from './db/db';
import { getProfile } from './repos/profile';
import { mountTestSeed } from './test/seed';

// Fonts CSS is loaded via dynamic import after the React tree mounts so the
// 22 KB of @font-face declarations don't render-block first paint. Browsers
// paint with system fallback first, then swap to Funnel/JetBrains when ready
// (font-display: swap covers the swap behaviour). Vite emits this as a
// separate async CSS chunk.
function loadFontsAsync(): void {
  void import('./styles/fonts.css');
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

interface BootCleanup {
  __inventarBootCleanup?: () => void;
}

function clearBootFallback(): void {
  const cleanup = (window as unknown as BootCleanup).__inventarBootCleanup;
  if (typeof cleanup === 'function') cleanup();
}

async function bootstrap(): Promise<void> {
  mountTestSeed();
  await initI18n();
  // Ask for storage persistence as soon as the app boots IF the user has
  // already completed onboarding (otherwise the prompt is too early — we
  // ask again right after the user types their shop name).
  const profile = await getProfile(db);
  if (profile) await ensurePersistence(db);

  // Drop the inline boot fallback BEFORE we mount React so the spinner
  // doesn't briefly flash alongside the App. The fallback DOM lives at
  // /index.html inside #root and is removed via __inventarBootCleanup.
  clearBootFallback();

  createRoot(rootEl!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );

  loadFontsAsync();
  registerServiceWorker();
}

void bootstrap().catch((e: unknown) => {
  // bootstrap rejected — i18n / Dexie migration / persistence threw
  // before React got to mount. The inline fallback (index.html) catches
  // unhandled rejections too and surfaces its own UI, but we also log
  // here so DevTools shows a stack trace and the merchant can forward
  // it via a screenshot.
  console.error('bootstrap failed', e);
});
