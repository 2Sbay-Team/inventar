import { Component, type ErrorInfo, type ReactNode } from 'react';

// v0.5.1: top-level error boundary. Catches render-time crashes (a
// thrown component, a malformed Movement leaking into a calc, a stale
// state shape after a partially-failed migration) and shows a static
// fallback with an in-place "clear cache & reload" escape hatch — the
// React-tree analogue of the inline boot fallback in index.html.
//
// The boundary is intentionally above any router, layout or providers
// so a crash in any screen surfaces here instead of leaving the user
// on a blank page. We do not retry — if the React tree is broken, a
// re-render with the same state would crash again. The merchant has
// to either reload or clear the cache, both of which we offer here.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log so the stack trace shows up in DevTools and the merchant
    // can screenshot it. Sentry / remote logging is out of scope for
    // the offline-first MVP.
    console.error('ErrorBoundary caught', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleClearCache = async (): Promise<void> => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.error('clear cache from boundary failed', e);
    }
    window.location.reload();
  };

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    // English-only copy on purpose: we can't trust i18next state once
    // the React tree has crashed (it might be the cause). The fallback
    // has to work standalone.
    const message = this.state.error.message || 'Unknown error';
    return (
      <div
        data-testid="error-boundary-fallback"
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#FFF8F2',
          color: '#2A2A2A',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <h1 style={{ fontSize: 18, margin: '0 0 8px', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#6B6B6B', margin: '0 0 16px' }}>
            The app hit an error and can't continue. Your shop data is safe — try reloading, or
            clear the cache if the problem keeps happening.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              data-testid="error-boundary-clear-cache"
              onClick={() => void this.handleClearCache()}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: 'none',
                background: '#B45309',
                color: 'white',
                font: 'inherit',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Clear cache &amp; reload
            </button>
            <button
              type="button"
              data-testid="error-boundary-reload"
              onClick={this.handleReload}
              style={{
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.12)',
                background: 'white',
                color: '#2A2A2A',
                font: 'inherit',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Just reload
            </button>
          </div>
          <small
            data-testid="error-boundary-message"
            style={{
              display: 'block',
              fontSize: 11,
              color: '#999',
              marginTop: 16,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              wordBreak: 'break-word',
            }}
          >
            {message.slice(0, 200)}
          </small>
        </div>
      </div>
    );
  }
}
