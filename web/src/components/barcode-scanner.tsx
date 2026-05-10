import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { ScanLine, X } from 'lucide-react';

// Native BarcodeDetector — Chrome / Edge / Samsung Internet on Android,
// Chrome on desktop, Safari (recent). Firefox: not supported. We feature-
// detect at module load and fall back to a "use your phone's camera"
// instructions card on unsupported browsers.

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): {
    detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
  };
  getSupportedFormats?: () => Promise<string[]>;
}

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  // Called with the raw scanned value (e.g. an EAN-13 string, or a URL
  // for QR codes). Caller decides what to do with it.
  onDetected: (value: string) => void;
  // v0.5 ADR-018: when true, the rAF loop keeps running after onDetected
  // fires so the user can scan another code without re-opening the
  // modal. Each value is suppressed within a SAME_VALUE_COOLDOWN_MS
  // window so the same code isn't re-emitted while the camera lingers
  // on it. Used by /receive and /sell — both flows scan one item after
  // another.
  keepOpenAfterDetect?: boolean;
}

const SAME_VALUE_COOLDOWN_MS = 1500;

export function BarcodeScanner({
  open,
  onClose,
  onDetected,
  keepOpenAfterDetect = false,
}: BarcodeScannerProps): JSX.Element {
  const { t } = useTranslation('add');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Tracks the most recent emission so streaming mode can suppress
  // duplicate frames of the same code without losing distinct codes.
  const lastEmittedRef = useRef<{ value: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = getBarcodeDetector() !== null;

  // v0.5 ADR-018: e2e test surface. Headless playwright cannot feed real
  // video frames to BarcodeDetector, so we listen for a CustomEvent that
  // the seed surface dispatches in its place. Only mounted when the
  // bundle was built with VITE_E2E=true (production never sees this).
  useEffect(() => {
    if (!open) return;
    if (!import.meta.env.VITE_E2E) return;
    function handleE2eScan(ev: Event): void {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      if (!detail?.value) return;
      const now = Date.now();
      const dup =
        lastEmittedRef.current &&
        lastEmittedRef.current.value === detail.value &&
        now - lastEmittedRef.current.at < SAME_VALUE_COOLDOWN_MS;
      if (dup) return;
      lastEmittedRef.current = { value: detail.value, at: now };
      onDetected(detail.value);
    }
    document.addEventListener('inventar:e2e-scan', handleE2eScan);
    return () => document.removeEventListener('inventar:e2e-scan', handleE2eScan);
  }, [open, onDetected]);

  useEffect(() => {
    if (!open) return;
    if (!supported) return;
    // Reset cooldown each time the scanner opens — a fresh session
    // shouldn't be silenced by a code emitted in a previous one.
    lastEmittedRef.current = null;

    let cancelled = false;
    const Detector = getBarcodeDetector();
    if (!Detector) return;
    const detector = new Detector({
      formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e'],
    });

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();

        const tick = async (): Promise<void> => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0]) {
              const value = codes[0].rawValue;
              const now = Date.now();
              const dup =
                lastEmittedRef.current &&
                lastEmittedRef.current.value === value &&
                now - lastEmittedRef.current.at < SAME_VALUE_COOLDOWN_MS;
              if (!dup) {
                lastEmittedRef.current = { value, at: now };
                onDetected(value);
                if (!keepOpenAfterDetect) return;
              }
            }
          } catch {
            // Detector occasionally throws on a black frame — ignore
            // and try again next animation frame.
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        await tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'camera unavailable';
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [open, supported, onDetected, keepOpenAfterDetect]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          data-testid="barcode-scanner"
          className="fixed inset-x-0 bottom-0 max-h-[90dvh] overflow-hidden rounded-t-3xl bg-black shadow-xl"
        >
          <div className="flex items-center justify-between bg-black/80 px-4 py-3 text-white">
            <Dialog.Title className="font-display inline-flex items-center gap-2 text-sm font-semibold">
              <ScanLine aria-hidden className="h-4 w-4" strokeWidth={2} />
              {t('scan_title')}
            </Dialog.Title>
            <Dialog.Close
              type="button"
              data-testid="barcode-scanner-close"
              className="rounded-full p-1 text-white/80 hover:text-white"
            >
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          {!supported ? (
            <div className="bg-paper p-6 text-center">
              <p className="text-ink text-sm font-medium">{t('scan_unsupported_title')}</p>
              <p className="text-ink-2 mt-2 text-xs leading-relaxed">
                {t('scan_unsupported_body')}
              </p>
            </div>
          ) : error ? (
            <div className="bg-paper p-6 text-center">
              <p className="text-bad text-sm font-medium">{t('scan_error_title')}</p>
              <p className="text-ink-2 mt-2 text-xs leading-relaxed">{error}</p>
            </div>
          ) : (
            <div className="relative aspect-[3/4] w-full bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
                aria-label={t('scan_title')}
              />
              {/* Reticle overlay so the user knows where to aim. */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="border-accent/80 h-48 w-48 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
              </div>
              <p className="text-white/80 absolute inset-x-0 bottom-4 text-center text-xs">
                {t('scan_hint')}
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
