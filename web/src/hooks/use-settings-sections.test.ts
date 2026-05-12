import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SECTIONS_STORAGE_KEY,
  parseSectionState,
  toggleSection,
} from './use-settings-sections';

describe('parseSectionState', () => {
  // N+1 acceptance — "All sections collapsed by default on first load"
  // is anchored here: with no stored value, the parser returns {} which
  // makes every isOpen(id) → false.
  it('returns empty state when storage is missing', () => {
    expect(parseSectionState(null)).toEqual({});
    expect(parseSectionState('')).toEqual({});
  });

  it('round-trips a JSON object of booleans', () => {
    const raw = JSON.stringify({ language: true, backup: false });
    expect(parseSectionState(raw)).toEqual({ language: true, backup: false });
  });

  it('coerces truthy / falsy values to booleans (defensive)', () => {
    const raw = JSON.stringify({ a: 1, b: 0, c: 'yes', d: null });
    expect(parseSectionState(raw)).toEqual({ a: true, b: false, c: true, d: false });
  });

  it('falls back to {} for malformed JSON', () => {
    expect(parseSectionState('not json')).toEqual({});
  });

  it('falls back to {} for non-object payloads (array, scalar)', () => {
    expect(parseSectionState('[1, 2, 3]')).toEqual({});
    expect(parseSectionState('"language"')).toEqual({});
    expect(parseSectionState('42')).toEqual({});
  });
});

describe('toggleSection', () => {
  // N+5 acceptance — toggling persists; the pure helper that drives the
  // state transitions is unit-tested here so the React layer only has
  // to wire it to localStorage.
  it('toggles a missing key from false to true', () => {
    expect(toggleSection({}, 'language')).toEqual({ language: true });
  });

  it('toggles a true key back to false', () => {
    expect(toggleSection({ language: true }, 'language')).toEqual({ language: false });
  });

  it('toggles a false key to true without touching siblings', () => {
    expect(toggleSection({ language: false, backup: true }, 'language')).toEqual({
      language: true,
      backup: true,
    });
  });

  it('returns a new object reference (immutable update)', () => {
    const before = { language: true };
    const after = toggleSection(before, 'backup');
    expect(after).not.toBe(before);
    expect(before).toEqual({ language: true });
  });
});

describe('SETTINGS_SECTIONS_STORAGE_KEY', () => {
  it('is namespaced + versioned so a schema bump can ignore old keys', () => {
    expect(SETTINGS_SECTIONS_STORAGE_KEY).toMatch(/^inventar\.settings\.sections\.v\d+$/);
  });
});
