import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock react-router-dom before importing the hook.
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

import { useSafeBack } from './use-safe-back';

// The hook reads window.history.length; provide a minimal global in node env.
function setHistoryLength(n: number): void {
  Object.defineProperty(globalThis, 'window', {
    value: { history: { length: n } },
    writable: true,
    configurable: true,
  });
}

describe('useSafeBack', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('navigates back when history has entries', () => {
    setHistoryLength(5);
    const goBack = useSafeBack();
    goBack();
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('falls back to /reports when history is empty', () => {
    setHistoryLength(1);
    const goBack = useSafeBack();
    goBack();
    expect(mockNavigate).toHaveBeenCalledWith('/reports', { replace: true });
  });

  it('uses a custom fallback when provided', () => {
    setHistoryLength(1);
    const goBack = useSafeBack('/products');
    goBack();
    expect(mockNavigate).toHaveBeenCalledWith('/products', { replace: true });
  });
});
