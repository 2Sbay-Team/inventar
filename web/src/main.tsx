import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
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

async function bootstrap(): Promise<void> {
  mountTestSeed();
  await initI18n();
  // Ask for storage persistence as soon as the app boots IF the user has
  // already completed onboarding (otherwise the prompt is too early — we
  // ask again right after the user types their shop name).
  const profile = await getProfile(db);
  if (profile) await ensurePersistence(db);

  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  loadFontsAsync();
  registerServiceWorker();
}

void bootstrap();
