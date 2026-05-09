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

export function useInstallPrompt(): InstallState {
  const [state, setState] = useState<InstallState>(() => {
    if (isStandalone()) return { kind: 'installed' };
    if (isIOS()) return { kind: 'ios-instructions' };
    return { kind: 'unsupported' };
  });

  useEffect(() => {
    function onBeforeInstall(e: Event): void {
      const evt = e as BeforeInstallPromptEvent;
      e.preventDefault();
      setState({
        kind: 'installable',
        install: async () => {
          await evt.prompt();
          const choice = await evt.userChoice;
          if (choice.outcome === 'accepted') {
            setState({ kind: 'installed' });
          }
          return choice.outcome;
        },
      });
    }
    function onInstalled(): void {
      setState({ kind: 'installed' });
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return state;
}
