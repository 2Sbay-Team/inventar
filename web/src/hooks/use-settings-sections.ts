import { useCallback, useEffect, useState } from 'react';

// localStorage key holding the merchant's per-section open/close state.
// Versioned in case the schema grows (e.g. ordered visit history).
export const SETTINGS_SECTIONS_STORAGE_KEY = 'inventar.settings.sections.v1';

type SectionId = string;

export interface SectionState {
  [id: SectionId]: boolean;
}

// Parse a raw localStorage payload into a SectionState. Any malformed
// input falls back to {} so a tampered key can't crash the screen.
// Exported (and pure) so the unit tests can exercise the parser
// without a DOM.
export function parseSectionState(raw: string | null): SectionState {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SectionState = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = Boolean(v);
    }
    return out;
  } catch {
    return {};
  }
}

// Toggle a single id on/off; returns the next state. Pure for testing.
export function toggleSection(state: SectionState, id: SectionId): SectionState {
  return { ...state, [id]: !state[id] };
}

function readStored(): SectionState {
  if (typeof window === 'undefined') return {};
  return parseSectionState(window.localStorage.getItem(SETTINGS_SECTIONS_STORAGE_KEY));
}

function writeStored(state: SectionState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_SECTIONS_STORAGE_KEY, JSON.stringify(state));
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
