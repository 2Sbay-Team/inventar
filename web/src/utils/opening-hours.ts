// v0.9 Phase 7 — Pure helpers for the Opening Hours weekly grid.
//
// The schema (types/index.ts) stores the whole week on
// ShopProfile.opening_hours, each day independently nullable:
//
//   opening_hours: { monday: DayHours | null, … } | null
//
// where `DayHours = { open: boolean, from: "HH:MM", to: "HH:MM" }`.
//
// Two flavours of "missing":
//   * opening_hours = null         → merchant has never opened the
//                                    Hours subsection. Catalogue +
//                                    business card should hide
//                                    opening hours entirely.
//   * any-day = null               → merchant edited the section but
//                                    that day is "use the default"
//                                    (Mon-Sat open 08:00-20:00 /
//                                    Sun closed).
//
// All helpers here are pure: no DOM access, no React. Tests cover
// the boundary cases in opening-hours.test.ts.

import type { DayHours, OpeningHours } from '../types';

export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export type DayKey = (typeof DAY_KEYS)[number];

const WEEKDAY_DEFAULT: DayHours = { open: true, from: '08:00', to: '20:00' };
const WEEKEND_CLOSED: DayHours = { open: false, from: '08:00', to: '20:00' };

// The Mon-Sat 08:00-20:00 / Sun closed schedule the brief calls out
// in the AUTOFILL INTELLIGENCE section. Used as the "first time
// the merchant opens the Hours UI" view-model and as the source of
// truth for any day the merchant hasn't explicitly customised.
export const DEFAULT_WEEK: OpeningHours = {
  monday: WEEKDAY_DEFAULT,
  tuesday: WEEKDAY_DEFAULT,
  wednesday: WEEKDAY_DEFAULT,
  thursday: WEEKDAY_DEFAULT,
  friday: WEEKDAY_DEFAULT,
  saturday: WEEKDAY_DEFAULT,
  sunday: WEEKEND_CLOSED,
};

// Returns the same week the editor renders: stored values per day,
// falling back to DEFAULT_WEEK[day] when null. Never returns null
// — callers always get seven DayHours objects, ready to display
// without further branching.
export function deriveWeek(opening_hours: OpeningHours | null | undefined): OpeningHours {
  if (!opening_hours) return { ...DEFAULT_WEEK };
  const out: Partial<OpeningHours> = {};
  for (const day of DAY_KEYS) {
    out[day] = opening_hours[day] ?? DEFAULT_WEEK[day];
  }
  return out as OpeningHours;
}

// Replaces a single day's value inside a week. Returns a new
// OpeningHours; the input is not mutated. Used by every per-day
// toggle / time-input change in the editor.
export function setDay(week: OpeningHours, day: DayKey, value: DayHours): OpeningHours {
  return { ...week, [day]: value };
}

// "Apply Monday's hours to every other day."
//
// Closed destination days stay closed — copying Monday's open=true
// onto them would silently change the merchant's mind, so we
// preserve `open: false` and only mirror the `from`/`to` times.
// Open days adopt Monday's full state (open=true, from, to).
//
// If Monday itself is closed, this is a no-op for closed days
// (already closed) and sets every other open day to closed via
// the same from/to-but-stay-open rule — except that's contradictory.
// Choose: when Monday is closed, leave the rest of the week alone.
// Editing Monday closed and then bulk-applying "all days closed"
// belongs to a different UX (Vacation mode, not Phase 7).
export function applyMondayToOthers(week: OpeningHours): OpeningHours {
  const monday = week.monday;
  if (monday === null) return week;
  if (!monday.open) return week; // closed-Monday no-op (see comment)
  const result: Partial<OpeningHours> = { monday };
  for (const day of DAY_KEYS) {
    if (day === 'monday') continue;
    const existing = week[day];
    if (existing === null || !existing.open) {
      // Closed days stay closed but adopt the new from/to silently
      // so a later "Open" toggle pre-fills the same hours as Monday.
      result[day] = {
        open: existing?.open ?? false,
        from: monday.from,
        to: monday.to,
      };
    } else {
      result[day] = { open: true, from: monday.from, to: monday.to };
    }
  }
  return result as OpeningHours;
}

// Clamps an "HH:MM" string into a canonical shape. Invalid input
// (non-numeric, out-of-range hour/minute) returns the fallback
// passed in — usually the previously-stored value so a bad keypress
// doesn't corrupt the row.
export function normaliseTime(value: string, fallback: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) return fallback;
  const hour = parseInt(match[1]!, 10);
  const minute = parseInt(match[2]!, 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

// Returns true when the merchant has materialised any opening hours
// (any day is non-null in storage). Used by the catalogue + business
// card to decide whether to render the "Hours" section at all.
export function hasAnyHours(opening_hours: OpeningHours | null | undefined): boolean {
  if (!opening_hours) return false;
  return DAY_KEYS.some((day) => opening_hours[day] !== null);
}
