import { Workbox } from 'workbox-window';

// v0.6 ADR-030 — manual SW registration with consent-driven activation.
//
// vite-plugin-pwa is configured (vite.config.ts) with
//   `skipWaiting: false` + `injectRegister: false`
// so a newly-installed SW stays in the WAITING state until we tell it
// to take over. The decision to take over is made by the merchant via
// the update-consent modal (AppUpdateModal); this module only exposes
// the lifecycle hooks the modal needs.
//
// Subscribers (React hooks) can attach to the handle at any time —
// even BEFORE registerServiceWorker() has been called. The handle is
// a module-level singleton with a stable listener bag, so a useEffect
// that mounts before bootstrap finishes won't miss a later event.

type SwEvent = 'waiting' | 'controllerchange' | 'ready';

export interface SwHandle {
  on(event: SwEvent, handler: () => void): () => void;
  // Sends SKIP_WAITING to the waiting SW. Resolves once the new SW
  // becomes the page's controller (i.e. controllerchange has fired).
  // No-op when the real registration hasn't been wired yet.
  activateWaiting(): Promise<void>;
}

const listeners: Record<SwEvent, Set<() => void>> = {
  waiting: new Set(),
  controllerchange: new Set(),
  ready: new Set(),
};

function emit(event: SwEvent): void {
  for (const fn of listeners[event]) {
    try {
      fn();
    } catch (err) {
      console.error('[register-sw] listener threw', err);
    }
  }
}

// The function actually called by activateWaiting(). Swapped in by
// registerServiceWorker() once Workbox has registered, and by the
// e2e test seam for in-context simulation.
let activateImpl: () => Promise<void> = async () => {};

const handle: SwHandle = {
  on(event, fn) {
    listeners[event].add(fn);
    return () => listeners[event].delete(fn);
  },
  async activateWaiting() {
    await activateImpl();
  },
};

export function getSwHandle(): SwHandle {
  return handle;
}

let registered = false;

export function registerServiceWorker(): void {
  if (registered) return;
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  registered = true;
  const wb = new Workbox('/sw.js', { scope: '/' });

  wb.addEventListener('waiting', () => {
    // v0.6 ADR-030 — DO NOT call wb.messageSkipWaiting() here. The
    // merchant decides via the modal; we just announce the event.
    emit('waiting');
  });

  wb.addEventListener('controlling', () => emit('controllerchange'));

  wb.addEventListener('activated', (event) => {
    if (!event.isUpdate) emit('ready');
  });

  activateImpl = async () => {
    // Race the controllerchange event against a 10 s timeout so a
    // wedged SW can't hang the consent flow forever (the caller
    // shows an error and lets the merchant try again).
    const waitForControlling = new Promise<void>((resolve) => {
      const off = handle.on('controllerchange', () => {
        off();
        resolve();
      });
    });
    void wb.messageSkipWaiting();
    await Promise.race([
      waitForControlling,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('SW activation timed out after 10 s')), 10_000),
      ),
    ]);
  };

  void wb.register();
}

// ── Test seams ──────────────────────────────────────────────────────

// Used by vitest to clear listener state between tests.
export function __resetSwHandleForTests(): void {
  listeners.waiting.clear();
  listeners.controllerchange.clear();
  listeners.ready.clear();
  activateImpl = async () => {};
  registered = false;
}

// v0.6 ADR-030 — e2e test seam. Wires activateImpl to a synchronous
// stub that simulates the controllerchange event after SKIP_WAITING.
// Returns controls so the spec can fire the 'waiting' event manually
// AND read the number of activation calls. Gated on VITE_E2E so this
// dead-code-eliminates from production bundles.
export function __installFakeSwHandleForE2E(): {
  emitWaiting: () => void;
  readonly activateCalls: number;
} {
  if (!import.meta.env.VITE_E2E) {
    throw new Error('__installFakeSwHandleForE2E called outside VITE_E2E');
  }
  const stats = { activateCalls: 0 };
  activateImpl = async () => {
    stats.activateCalls += 1;
    queueMicrotask(() => emit('controllerchange'));
  };
  return {
    emitWaiting: () => emit('waiting'),
    get activateCalls() {
      return stats.activateCalls;
    },
  };
}
