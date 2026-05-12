// v0.9 Phase 4a — Tiny debouncer used by the Shop Identity autosave
// pipeline. Pure factory (no React, no DOM) so vitest can pin the
// behaviour with fake timers.
//
// Contract:
//   * Each call to `.trigger(value)` resets a `delayMs` timer.
//   * When the timer fires, `onFlush(latestValue)` runs.
//   * `.flush()` forces an immediate fire of the pending value.
//   * `.cancel()` drops the pending value without firing.
//
// `setTimeout` / `clearTimeout` are injectable purely for tests —
// production passes the globals.

export interface Debouncer<T> {
  trigger(value: T): void;
  flush(): void;
  cancel(): void;
  hasPending(): boolean;
}

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimeoutFn = (cb: () => void, ms: number) => TimerHandle;
type ClearTimeoutFn = (handle: TimerHandle) => void;

export interface CreateDebouncerOptions<T> {
  delayMs: number;
  onFlush: (value: T) => void;
  setTimeoutFn?: SetTimeoutFn;
  clearTimeoutFn?: ClearTimeoutFn;
}

export function createDebouncer<T>(options: CreateDebouncerOptions<T>): Debouncer<T> {
  const { delayMs, onFlush, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = options;
  let handle: TimerHandle | null = null;
  let pending: { value: T } | null = null;

  function clear(): void {
    if (handle !== null) {
      clearTimeoutFn(handle);
      handle = null;
    }
  }

  return {
    trigger(value) {
      pending = { value };
      clear();
      handle = setTimeoutFn(() => {
        handle = null;
        const snapshot = pending;
        pending = null;
        if (snapshot !== null) onFlush(snapshot.value);
      }, delayMs);
    },
    flush() {
      if (pending === null) return;
      clear();
      const snapshot = pending;
      pending = null;
      onFlush(snapshot.value);
    },
    cancel() {
      pending = null;
      clear();
    },
    hasPending() {
      return pending !== null;
    },
  };
}
