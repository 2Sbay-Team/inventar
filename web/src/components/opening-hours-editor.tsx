import { useTranslation } from 'react-i18next';
import {
  applyMondayToOthers,
  DAY_KEYS,
  type DayKey,
  deriveWeek,
  normaliseTime,
  setDay,
} from '../utils/opening-hours';
import type { OpeningHours } from '../types';

// v0.9 Phase 7 — Opening Hours weekly grid.
//
// Renders seven rows (Mon → Sun), each with an Open / Closed toggle
// and `<input type="time">` widgets for from / to. The Closed rows
// hide the time inputs entirely (`open: false` is the storage shape
// — the from/to stay in the DB so re-opening pre-fills the prior
// values).
//
// "Apply Monday hours to other days" sits at the bottom and copies
// Monday's from/to into every other day, preserving each day's
// open/closed flag. See applyMondayToOthers for the exact rule.

export interface OpeningHoursEditorProps {
  value: OpeningHours | null;
  onChange: (next: OpeningHours) => void;
}

export function OpeningHoursEditor({ value, onChange }: OpeningHoursEditorProps): JSX.Element {
  const { t } = useTranslation('settings');
  const week = deriveWeek(value);

  function patchDay(
    day: DayKey,
    patch: Partial<{ open: boolean; from: string; to: string }>,
  ): void {
    const current = week[day];
    if (current === null) return; // never; deriveWeek fills every slot
    onChange(
      setDay(week, day, {
        open: patch.open ?? current.open,
        from: patch.from ?? current.from,
        to: patch.to ?? current.to,
      }),
    );
  }

  function onApplyMondayToOthers(): void {
    onChange(applyMondayToOthers(week));
  }

  return (
    <div className="space-y-2" data-testid="opening-hours-editor">
      <div className="space-y-1.5">
        {DAY_KEYS.map((day) => {
          const hours = week[day]!;
          return (
            <div
              key={day}
              data-testid={`opening-hours-${day}`}
              className="grid grid-cols-[2.5rem_auto_1fr_auto] items-center gap-2"
            >
              <span className="text-ink-2 text-xs font-medium">
                {t(`opening_hours_day_${day}`)}
              </span>
              {/* Open/Closed toggle — explicit two-state pill rather than a
                  raw checkbox so the merchant can see both states at a glance. */}
              <button
                type="button"
                data-testid={`opening-hours-${day}-toggle`}
                aria-pressed={hours.open}
                onClick={() => patchDay(day, { open: !hours.open })}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                  hours.open
                    ? 'bg-accent-soft text-accent-ink border-accent/40 border'
                    : 'border-hair text-ink-3 border bg-white'
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    hours.open ? 'bg-accent' : 'bg-ink-4'
                  }`}
                />
                {hours.open ? t('opening_hours_open') : t('opening_hours_closed')}
              </button>
              {hours.open ? (
                <div className="flex items-center gap-1.5 text-xs">
                  <input
                    type="time"
                    data-testid={`opening-hours-${day}-from`}
                    value={hours.from}
                    onChange={(e) =>
                      patchDay(day, { from: normaliseTime(e.target.value, hours.from) })
                    }
                    className="border-hair focus-visible:ring-accent/40 rounded-md border bg-white px-1.5 py-0.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2"
                  />
                  <span className="text-ink-3" aria-hidden>
                    →
                  </span>
                  <input
                    type="time"
                    data-testid={`opening-hours-${day}-to`}
                    value={hours.to}
                    onChange={(e) => patchDay(day, { to: normaliseTime(e.target.value, hours.to) })}
                    className="border-hair focus-visible:ring-accent/40 rounded-md border bg-white px-1.5 py-0.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-2"
                  />
                </div>
              ) : (
                <span className="text-ink-3 text-[11px]">{t('opening_hours_closed_caption')}</span>
              )}
              <span aria-hidden /> {/* right-edge spacer for grid alignment */}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="opening-hours-apply-monday"
        onClick={onApplyMondayToOthers}
        className="border-hair text-ink-2 mt-2 w-full rounded-xl border bg-white py-2 text-[11px] font-medium"
      >
        {t('opening_hours_apply_monday')}
      </button>
    </div>
  );
}
