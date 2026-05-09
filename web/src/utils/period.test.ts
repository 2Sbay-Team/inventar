import { describe, expect, it } from 'vitest';
import { periodRange } from './period';

const NOON = new Date('2026-05-07T12:00:00.000Z'); // Thursday

describe('periodRange', () => {
  it('today: starts at midnight UTC, ends just after now', () => {
    const r = periodRange(NOON, 'today');
    expect(r.fromISO).toBe('2026-05-07T00:00:00.000Z');
    expect(r.toISO > r.fromISO).toBe(true);
  });
  it('week: rolls back to Monday', () => {
    // 2026-05-07 is Thursday; Monday of that week is 2026-05-04.
    const r = periodRange(NOON, 'week');
    expect(r.fromISO).toBe('2026-05-04T00:00:00.000Z');
  });
  it('month: rolls back to the 1st', () => {
    const r = periodRange(NOON, 'month');
    expect(r.fromISO).toBe('2026-05-01T00:00:00.000Z');
  });
  it('year: rolls back to Jan 1', () => {
    const r = periodRange(NOON, 'year');
    expect(r.fromISO).toBe('2026-01-01T00:00:00.000Z');
  });
});
