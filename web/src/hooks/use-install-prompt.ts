import { useEffect, useState } from 'react';

// Browser-fired event when the PWA meets the install criteria. Chrome,
// Edge, Samsung Internet, and modern Android browsers fire this. iOS Safari
// does NOT — there install is a manual "Add to Home Screen" from the share
// sheet, so we surface platform-specific instructions instead.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'ios-instructions' }
  | { kind: 'installable'; install: () => Promise<'accepted' | 'dismissed'> }
  | { kind: 'installed' };

// Module-level cache so we don't lose `beforeinstallprompt` events that
// fire before any React component has mounted. The browser only fires
// this event once per page load — if we miss it, the install prompt is
// gone for that session.
let cachedEvent: BeforeInstallPromptEvent | null = null;
let cachedInstalled = false;
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) cb();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    cachedInstalled = true;
    cachedEvent = null;
    notify();
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS Safari sets a non-standard `standalone` on the navigator.
  const navAny = navigator as Navigator & { standalone?: boolean };
  return navAny.standalone === true;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

// True if the device LIKELY can fire beforeinstallprompt eventually.
// Used to keep us in 'checking' state instead of jumping to 'unsupported'.
function isInstallCapableBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Chromium-based: Chrome, Edge, Opera, Samsung Internet, Brave (mostly).
  // Firefox does NOT fire the event. iOS Safari handled separately.
  if (/Firefox/i.test(ua)) return false;
  if (isIOS()) return false;
  return /Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(ua);
}

// Chrome on Android wraps installed PWAs in a WebAPK whose
// targetSdkVersion comes from the Chrome version itself. Android 14+
// rejects WebAPKs with targetSdkVersion below 23 with the dreaded
// "unsafe app blocked" dialog. The user then thinks our app is broken
// when in fact their Chrome is outdated.
//
// We check the major Chrome version (UA-CH would be cleaner but isn't
// universally available). Chrome 100+ ships modern WebAPKs; we use 110
// as a generous threshold to leave headroom.
const MIN_CHROME_FOR_INSTALL = 110;

export function detectOutdatedChromeOnAndroid(): { current: number; needed: number } | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (!/Android/i.test(ua)) return null;
  // Match plain Chrome and Chrome-derivatives that share the WebAPK
  // pipeline. Edge / Opera / SamsungBrowser do too but with their own
  // version numbers — we only act on the standalone "Chrome/N" token.
  const m = ua.match(/Chrome\/(\d+)/);
  if (!m || !m[1]) return null;
  const current = Number.parseInt(m[1], 10);
  if (!Number.isFinite(current) || current >= MIN_CHROME_FOR_INSTALL) return null;
  return { current, needed: MIN_CHROME_FOR_INSTALL };
}

const CHECK_TIMEOUT_MS = 3500;

function compute(checking: boolean): InstallState {
  if (cachedInstalled || isStandalone()) return { kind: 'installed' };
  if (cachedEvent) {
    const evt = cachedEvent;
    return {
      kind: 'installable',
      install: async () => {
        await evt.prompt();
        const choice = await evt.userChoice;
        if (choice.outcome === 'accepted') {
          cachedInstalled = true;
          cachedEvent = null;
          notify();
        }
        return choice.outcome;
      },
    };
  }
  if (isIOS()) return { kind: 'ios-instructions' };
  // We may still be early — the browser hasn't fired the event yet.
  // Stay in `checking` until either the event fires or our timeout
  // elapses, otherwise we jump straight to `unsupported` and the user
  // gets a confusing "use a recent browser" message on Chrome.
  if (checking && isInstallCapableBrowser()) return { kind: 'checking' };
  return { kind: 'unsupported' };
}

export function useInstallPrompt(): InstallState {
  const [checking, setChecking] = useState(true);
  const [state, setState] = useState<InstallState>(() => compute(true));

  useEffect(() => {
    const update = (): void => setState(compute(checking));
    subscribers.add(update);
    update();
    // Stop being in `checking` mode after the timeout — by then either
    // the event fired (we'd be `installable`) or the browser isn't going
    // to fire it (we drop to `unsupported`).
    const timer = window.setTimeout(() => {
      setChecking(false);
      setState(compute(false));
    }, CHECK_TIMEOUT_MS);
    return () => {
      subscribers.delete(update);
      window.clearTimeout(timer);
    };
  }, [checking]);

  return state;
}
