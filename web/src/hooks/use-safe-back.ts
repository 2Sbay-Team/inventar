import { useNavigate } from 'react-router-dom';

// Returns a navigation callback that goes back in history when possible,
// falling back to `fallback` when there is no history to pop (e.g. the
// user opened the page via a direct link / QR scan). Without this guard,
// navigate(-1) on an empty history stack exits the PWA entirely.
export function useSafeBack(fallback: string = '/reports'): () => void {
  const navigate = useNavigate();
  return () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  };
}
