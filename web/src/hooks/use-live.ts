import { useEffect, useState } from 'react';
import { liveQuery, type Subscription } from 'dexie';

// Tiny wrapper around Dexie's liveQuery that fits our typing/lint rules
// without pulling in `dexie-react-hooks` (not on the approved deps list).
//
// The `deps` array gates re-subscription the same way useEffect does — when
// any dep changes, we tear down the old subscription and start a new one.

export function useLive<T>(query: () => Promise<T>, deps: ReadonlyArray<unknown>): T | undefined;
export function useLive<T>(query: () => Promise<T>, deps: ReadonlyArray<unknown>, initial: T): T;
export function useLive<T>(
  query: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  initial?: T,
): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);

  useEffect(() => {
    const observable = liveQuery(query);
    const sub: Subscription = observable.subscribe({
      next: (v) => setValue(v as T),
      error: (err) => {
        // Surface as a console warning rather than crashing the screen — the
        // calling component decides whether `undefined` is an error state.
        console.warn('useLive query failed', err);
      },
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}
