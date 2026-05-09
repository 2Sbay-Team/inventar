import { Workbox } from 'workbox-window';

// Manual SW registration. Vite-plugin-pwa is configured with
// `injectRegister: false` so we call this exactly once from `main.tsx` and
// own the update lifecycle (SPEC §7).
//
// Behaviour:
//   - Skips registration entirely outside of production builds (dev server
//     has no SW; this saves a 404 on /sw.js during `npm run dev`).
//   - On a fresh install: registers, no toast.
//   - On an update: when the new SW reaches `waiting`, ask it to take
//     control (`SKIP_WAITING`), then surface a toast "Updated to v1.X" via
//     the supplied callback so the host can render it.
//
// We never reload mid-session — the new shell is active on next page load
// (SPEC §7: "no forced reload mid-session").

export interface RegisterOptions {
  // Called once when an updated SW has activated. The host renders the
  // "Updated to vX" toast (SPEC §7).
  onUpdated?: () => void;
  // Called when the SW becomes ready and is controlling the page for the
  // first time. Useful as a hook for a "you can use this offline now" toast.
  onReady?: () => void;
}

let registered = false;

export function registerServiceWorker(options: RegisterOptions = {}): void {
  if (registered) return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  registered = true;
  const wb = new Workbox('/sw.js', { scope: '/' });

  wb.addEventListener('waiting', () => {
    // A new SW finished installing and is waiting. Tell it to activate;
    // workbox-window will fire 'controlling' once it does.
    void wb.messageSkipWaiting();
  });

  wb.addEventListener('controlling', () => {
    options.onUpdated?.();
  });

  wb.addEventListener('activated', (event) => {
    if (!event.isUpdate) options.onReady?.();
  });

  void wb.register();
}
