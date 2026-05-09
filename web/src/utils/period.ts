// Dashboard period filtering. Returns inclusive [from, to) ISO bounds for
// the four periods on the Dashboard's segmented selector (SPEC §2.6).

export type Period = 'today' | 'week' | 'month' | 'year';

export interface PeriodRange {
  fromISO: string;
  toISO: string;
}

export function periodRange(now: Date, period: Period): PeriodRange {
  const start = new Date(now);
  const end = new Date(now);
  end.setUTCMilliseconds(end.getUTCMilliseconds() + 1);
  switch (period) {
    case 'today':
      start.setUTCHours(0, 0, 0, 0);
      break;
    case 'week': {
      start.setUTCHours(0, 0, 0, 0);
      const dayOfWeek = (start.getUTCDay() + 6) % 7; // Mon=0
      start.setUTCDate(start.getUTCDate() - dayOfWeek);
      break;
    }
    case 'month':
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      break;
    case 'year':
      start.setUTCMonth(0, 1);
      start.setUTCHours(0, 0, 0, 0);
      break;
  }
  return { fromISO: start.toISOString(), toISO: end.toISOString() };
}
