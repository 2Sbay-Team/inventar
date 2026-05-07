import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { now, nowISO } from './now';

describe('now / nowISO', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('now() returns a Date instance', () => {
    const d = now();
    expect(d).toBeInstanceOf(Date);
  });

  it('now() reflects vi.setSystemTime so it is mockable', () => {
    const fixed = new Date('2026-05-07T10:00:00.000Z');
    vi.setSystemTime(fixed);
    expect(now().toISOString()).toBe('2026-05-07T10:00:00.000Z');
  });

  it('nowISO() returns a UTC-Z ISO 8601 string', () => {
    vi.setSystemTime(new Date('2026-01-15T03:14:15.926Z'));
    const s = nowISO();
    expect(s).toBe('2026-01-15T03:14:15.926Z');
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('nowISO() advances when system time advances', () => {
    vi.setSystemTime(new Date('2026-05-07T10:00:00.000Z'));
    const a = nowISO();
    vi.setSystemTime(new Date('2026-05-07T10:00:00.500Z'));
    const b = nowISO();
    expect(a).not.toBe(b);
    expect(b > a).toBe(true);
  });
});
