import { describe, expect, it } from 'vitest';
import {
  applyMondayToOthers,
  DAY_KEYS,
  DEFAULT_WEEK,
  deriveWeek,
  hasAnyHours,
  normaliseTime,
  setDay,
} from './opening-hours';
import type { DayHours, OpeningHours } from '../types';

describe('DAY_KEYS / DEFAULT_WEEK', () => {
  it('exposes the seven keys in Mon→Sun order', () => {
    expect(DAY_KEYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });

  it('Mon-Sat open 08:00-20:00, Sun closed — matches the brief default', () => {
    for (const day of [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ] as const) {
      expect(DEFAULT_WEEK[day]).toEqual({ open: true, from: '08:00', to: '20:00' });
    }
    expect(DEFAULT_WEEK.sunday).toEqual({ open: false, from: '08:00', to: '20:00' });
  });
});

describe('deriveWeek', () => {
  it('returns the default week when opening_hours is null', () => {
    expect(deriveWeek(null)).toEqual(DEFAULT_WEEK);
  });

  it('returns the default week when opening_hours is undefined', () => {
    expect(deriveWeek(undefined)).toEqual(DEFAULT_WEEK);
  });

  it('merges stored values over defaults, day-by-day', () => {
    const stored: OpeningHours = {
      monday: { open: true, from: '09:00', to: '18:00' },
      tuesday: null, // falls back to default
      wednesday: { open: false, from: '10:00', to: '14:00' },
      thursday: null,
      friday: null,
      saturday: { open: true, from: '10:00', to: '23:00' },
      sunday: null,
    };
    const result = deriveWeek(stored);
    expect(result.monday).toEqual({ open: true, from: '09:00', to: '18:00' });
    expect(result.tuesday).toEqual(DEFAULT_WEEK.tuesday);
    expect(result.wednesday).toEqual({ open: false, from: '10:00', to: '14:00' });
    expect(result.saturday).toEqual({ open: true, from: '10:00', to: '23:00' });
    expect(result.sunday).toEqual(DEFAULT_WEEK.sunday);
  });

  it('does not mutate the input (returns a fresh object)', () => {
    const stored: OpeningHours = {
      monday: { open: true, from: '09:00', to: '18:00' },
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
    const before = JSON.stringify(stored);
    deriveWeek(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe('setDay', () => {
  it('replaces a single day, leaving the rest unchanged', () => {
    const updated = setDay(DEFAULT_WEEK, 'wednesday', {
      open: false,
      from: '00:00',
      to: '00:00',
    });
    expect(updated.wednesday).toEqual({ open: false, from: '00:00', to: '00:00' });
    expect(updated.monday).toBe(DEFAULT_WEEK.monday);
    expect(updated.sunday).toBe(DEFAULT_WEEK.sunday);
  });

  it('returns a fresh object — does not mutate the input', () => {
    const before = JSON.stringify(DEFAULT_WEEK);
    setDay(DEFAULT_WEEK, 'monday', { open: false, from: '00:00', to: '00:00' });
    expect(JSON.stringify(DEFAULT_WEEK)).toBe(before);
  });
});

describe('applyMondayToOthers', () => {
  it('copies open Monday hours to every other open day', () => {
    const week = setDay(DEFAULT_WEEK, 'monday', {
      open: true,
      from: '09:00',
      to: '21:00',
    });
    const result = applyMondayToOthers(week);
    for (const day of ['tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const) {
      expect(result[day]).toEqual({ open: true, from: '09:00', to: '21:00' });
    }
  });

  it('preserves closed days as closed (silently mirroring from/to for later "open" toggles)', () => {
    // Sunday is closed in DEFAULT_WEEK. After applyMondayToOthers it
    // should stay closed, just with Monday's from/to so toggling open
    // later pre-fills the right times.
    const week = setDay(DEFAULT_WEEK, 'monday', {
      open: true,
      from: '09:00',
      to: '21:00',
    });
    const result = applyMondayToOthers(week);
    expect(result.sunday).toEqual({ open: false, from: '09:00', to: '21:00' });
  });

  it('is a no-op when Monday is closed (no destructive bulk-close)', () => {
    const week = setDay(DEFAULT_WEEK, 'monday', {
      open: false,
      from: '08:00',
      to: '20:00',
    });
    const result = applyMondayToOthers(week);
    expect(result).toEqual(week);
  });

  it('is a no-op when Monday is null (untouched profile)', () => {
    const week: OpeningHours = { ...DEFAULT_WEEK, monday: null };
    const result = applyMondayToOthers(week);
    expect(result).toEqual(week);
  });

  it('Monday itself is preserved unchanged', () => {
    const week = setDay(DEFAULT_WEEK, 'monday', {
      open: true,
      from: '07:30',
      to: '19:30',
    });
    const result = applyMondayToOthers(week);
    expect(result.monday).toEqual({ open: true, from: '07:30', to: '19:30' });
  });
});

describe('normaliseTime', () => {
  it('parses valid HH:MM and zero-pads single-digit hours', () => {
    expect(normaliseTime('09:00', '00:00')).toBe('09:00');
    expect(normaliseTime('9:00', '00:00')).toBe('09:00');
    expect(normaliseTime('23:59', '00:00')).toBe('23:59');
    expect(normaliseTime('00:00', '08:00')).toBe('00:00');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseTime('  09:30  ', '00:00')).toBe('09:30');
  });

  it('returns fallback for invalid input', () => {
    expect(normaliseTime('', '08:00')).toBe('08:00');
    expect(normaliseTime('not a time', '08:00')).toBe('08:00');
    expect(normaliseTime('25:00', '08:00')).toBe('08:00'); // hour out of range
    expect(normaliseTime('12:60', '08:00')).toBe('08:00'); // minute out of range
    expect(normaliseTime('12:5', '08:00')).toBe('08:00'); // minute too short
    expect(normaliseTime('12', '08:00')).toBe('08:00'); // missing minute
  });
});

describe('hasAnyHours', () => {
  it('false for null / undefined opening_hours', () => {
    expect(hasAnyHours(null)).toBe(false);
    expect(hasAnyHours(undefined)).toBe(false);
  });

  it('false for an all-null week', () => {
    const week: OpeningHours = {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
    expect(hasAnyHours(week)).toBe(false);
  });

  it('true when any single day is set', () => {
    const day: DayHours = { open: true, from: '09:00', to: '17:00' };
    const week: OpeningHours = {
      monday: day,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };
    expect(hasAnyHours(week)).toBe(true);
  });
});
