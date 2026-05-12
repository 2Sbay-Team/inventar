import { useCallback, useEffect, useState } from 'react';

// localStorage key holding the merchant's per-section open/close state.
// Versioned in case the schema grows (e.g. ordered visit history). Reads
// are best-effort — any parse error / unavailable localStorage falls
// back to the "all collapsed" default.
const STORAGE_KEY = 'inventar.settings.sections.v1';

type SectionId = string;

interface SectionState {
  [id: SectionId]: boolean;
}

function readStored(): SectionState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Coerce every value to boolean so a tampered storage value can't
      // crash the screen later.
      const out: SectionState = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = Boolean(v);
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeStored(state: SectionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode — fail silently. The merchant's last-open
    // state isn't load-bearing for functionality, just for ergonomics.
  }
}

export interface SettingsSectionsApi {
  // True when the given section is open. Defaults to false (the brief:
  // "All collapsed by default on first load").
  isOpen: (id: SectionId) => boolean;
  // Toggle one section. Persists to localStorage on each call.
  toggle: (id: SectionId) => void;
}

export function useSettingsSections(): SettingsSectionsApi {
  const [state, setState] = useState<SectionState>(() => readStored());

  // Persist after every change. Kept in an effect (not inline) so a
  // tight series of toggles batches into one storage write.
  useEffect(() => {
    writeStored(state);
  }, [state]);

  const isOpen = useCallback((id: SectionId) => Boolean(state[id]), [state]);
  const toggle = useCallback((id: SectionId) => {
    setState((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return { isOpen, toggle };
}
