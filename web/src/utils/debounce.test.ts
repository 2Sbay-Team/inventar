import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncer } from './debounce';

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once after delayMs with the latest value (rapid edits coalesce)', () => {
    const flush = vi.fn<(value: string) => void>();
    const d = createDebouncer<string>({ delayMs: 800, onFlush: flush });
    d.trigger('a');
    vi.advanceTimersByTime(200);
    d.trigger('ab');
    vi.advanceTimersByTime(200);
    d.trigger('abc');
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith('abc');
  });

  it('does not fire if cancelled before delay elapses', () => {
    const flush = vi.fn();
    const d = createDebouncer<string>({ delayMs: 800, onFlush: flush });
    d.trigger('x');
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(flush).not.toHaveBeenCalled();
  });

  it('flush() fires immediately and clears the pending value', () => {
    const flush = vi.fn<(value: string) => void>();
    const d = createDebouncer<string>({ delayMs: 800, onFlush: flush });
    d.trigger('hello');
    expect(d.hasPending()).toBe(true);
    d.flush();
    expect(flush).toHaveBeenCalledWith('hello');
    expect(d.hasPending()).toBe(false);
    // No double-fire when the timer would have elapsed later.
    vi.advanceTimersByTime(2000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('flush() with no pending is a no-op', () => {
    const flush = vi.fn();
    const d = createDebouncer<string>({ delayMs: 800, onFlush: flush });
    d.flush();
    expect(flush).not.toHaveBeenCalled();
  });

  it('two debouncers do not interfere with each other', () => {
    const flushA = vi.fn();
    const flushB = vi.fn();
    const a = createDebouncer<string>({ delayMs: 500, onFlush: flushA });
    const b = createDebouncer<string>({ delayMs: 500, onFlush: flushB });
    a.trigger('A');
    b.trigger('B');
    vi.advanceTimersByTime(500);
    expect(flushA).toHaveBeenCalledWith('A');
    expect(flushB).toHaveBeenCalledWith('B');
  });

  it('hasPending() flips true → false across the timer fire', () => {
    const d = createDebouncer<number>({ delayMs: 100, onFlush: () => undefined });
    expect(d.hasPending()).toBe(false);
    d.trigger(1);
    expect(d.hasPending()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(d.hasPending()).toBe(false);
  });
});
