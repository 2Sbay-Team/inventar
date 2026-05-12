import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDebouncer, type Debouncer } from '../utils/debounce';

// v0.9 ADR-041 — Shop Identity autosave hook. Thin React wrapper
// around the pure createDebouncer factory. Three pieces of state
// callers care about:
//
//   * `trigger(value)` — call from onChange. The hook coalesces
//     rapid edits into a single save 800ms after the merchant stops
//     typing.
//   * `flush()` — fire an immediate save (use on blur if you want
//     the save to be visible before the merchant tabs away; the
//     unmount cleanup also flushes so no edit is lost on navigation).
//   * `status` — 'idle' / 'saving' / 'saved' / 'error'. Drives the
//     "Saved ✓" indicator. `saved` decays back to `idle` after the
//     configured fadeMs.
//
// Errors are surfaced both in the status return AND via console.error
// — the brief asks for an inline "⚠ Save failed" message but Phase
// 4a doesn't render it yet (the field row would need an error slot).
// A follow-up phase wires the visible error UI.

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutosaveOptions {
  delayMs?: number;
  fadeMs?: number;
}

export interface UseAutosave<T> {
  trigger: (value: T) => void;
  flush: () => void;
  status: AutosaveStatus;
}

export function useAutosave<T>(
  commit: (value: T) => Promise<void>,
  options: UseAutosaveOptions = {},
): UseAutosave<T> {
  const { delayMs = 800, fadeMs = 2000 } = options;
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const fadeRef = useRef<number | null>(null);

  // The debouncer is stable across renders. Recreating it every
  // render would reset the pending state mid-keystroke.
  const debouncer = useMemo<Debouncer<T>>(() => {
    function clearFade(): void {
      if (fadeRef.current !== null) {
        window.clearTimeout(fadeRef.current);
        fadeRef.current = null;
      }
    }
    return createDebouncer<T>({
      delayMs,
      onFlush: (value) => {
        setStatus('saving');
        clearFade();
        void commitRef
          .current(value)
          .then(() => {
            setStatus('saved');
            fadeRef.current = window.setTimeout(() => {
              setStatus('idle');
              fadeRef.current = null;
            }, fadeMs);
          })
          .catch((err: unknown) => {
            console.error('[autosave] commit failed', err);
            setStatus('error');
          });
      },
    });
    // delayMs / fadeMs are intentionally only read at mount — the
    // debouncer captures them in the closure. The hook isn't designed
    // for dynamic delay changes; if a caller needs that, recreate the
    // wrapping component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount: flush any pending save so the merchant
  // doesn't lose their last edit on navigation. Then clear the
  // fade timer so it doesn't fire on an unmounted setState.
  useEffect(() => {
    return () => {
      debouncer.flush();
      if (fadeRef.current !== null) {
        window.clearTimeout(fadeRef.current);
        fadeRef.current = null;
      }
    };
  }, [debouncer]);

  const trigger = useCallback(
    (value: T) => {
      debouncer.trigger(value);
    },
    [debouncer],
  );

  const flush = useCallback(() => {
    debouncer.flush();
  }, [debouncer]);

  return { trigger, flush, status };
}
