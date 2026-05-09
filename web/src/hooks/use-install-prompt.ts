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
  | { kind: 'unsupported' }
  | { kind: 'ios-instructions' }
  | { kind: 'installable'; install: () => Promise<'accepted' | 'dismissed'> }
  | { kind: 'installed' };

// Module-level cache so we don't lose `beforeinstallprompt` events that
// fire before any React component has mounted. The browser only fires
// this event once per page load — if we miss it, the install prompt is
// gone for that session. Hooks read from this cache at mount time.
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

function compute(): InstallState {
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
  return { kind: 'unsupported' };
}

export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(compute);

  useEffect(() => {
    const update = (): void => setState(compute());
    subscribers.add(update);
    // Re-check on mount in case the event fired between module-load and now
    // OR the user installed via a different mechanism in another tab.
    update();
    return () => {
      subscribers.delete(update);
    };
  }, []);

  return state;
}
