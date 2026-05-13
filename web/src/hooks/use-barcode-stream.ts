import { useEffect, useRef, useState } from 'react';
import { normalizeEan } from '../utils/ean';

// v0.5 ADR-018: shared barcode-stream hook used by /receive and /sell.
//
// Both screens want the same camera + BarcodeDetector + RAF loop with
// the same cooldown semantics: a code is emitted at most once per
// SAME_VALUE_COOLDOWN_MS window, and the caller can gate emissions
// dynamically via an `isBlocked` predicate (e.g. "sheet is open right
// now"). The hook also installs a parallel CustomEvent listener gated
// on import.meta.env.VITE_E2E so headless playwright can drive scans
// through `__inventarSeed.simulateScan` without faking BarcodeDetector.
//
// The hook RETURNS a videoRef the caller binds to its own <video>
// element. It owns nothing of the page layout — that stays with the
// screen so /receive's camera-fullscreen vs /sell's camera-fullscreen-
// with-cart-peek can render however they like.
//
// Closure handling: `onDetect` and `isBlocked` are kept in refs that
// are updated on every render. Without that, the camera loop (started
// once, deps=[supported]) would call the mount-time closures and miss
// state updates the screen does between scans.

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): {
    detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
  };
}

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

const SAME_VALUE_COOLDOWN_MS = 1500;

const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'] as const;

export interface UseBarcodeStreamOptions {
  // Called for each fresh detection that passed the cooldown gate.
  // The caller is expected to do its own EAN validation; the hook
  // only normalises whitespace before dispatching.
  onDetect: (value: string) => void;
  // Optional predicate that suppresses dispatches without tearing
  // down the camera. Typical use: `() => sheetOpenRef.current`.
  isBlocked?: () => boolean;
}

export interface UseBarcodeStreamResult {
  // Bind to your <video> element. The hook attaches a MediaStream and
  // calls play() once getUserMedia resolves.
  videoRef: React.RefObject<HTMLVideoElement>;
  // false on Firefox / Safari versions without BarcodeDetector. The
  // caller should render an "unsupported" UI instead of the video.
  supported: boolean;
  // getUserMedia rejection (camera busy, permission denied, etc.).
  // null on success.
  error: string | null;
}

// v0.9.x — desktops without a real camera produce a multi-second black
// <video> before our 2.5s watchdog kicks in. Most non-touch devices that
// land on /sale don't actually have a usable camera (laptop webcams in
// landscape are useless for the merchant's POS use case), so we gate the
// camera path on "this is a touch device" plus the standard
// BarcodeDetector + mediaDevices checks. Desktops fall straight through
// to the existing `!supported` fallback card — no black flash.
function hasCameraAffordance(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  // Touch-capable + a coarse pointer = phone or tablet, the actual POS
  // form-factors merchants use. Desktop Chrome reports neither even with
  // a webcam attached, which gives us the desktop short-circuit we want.
  const touchPoints = typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0;
  const hasTouch = touchPoints > 0 || 'ontouchstart' in window;
  const coarsePointer =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false;
  return hasTouch && coarsePointer;
}

export function useBarcodeStream(opts: UseBarcodeStreamOptions): UseBarcodeStreamResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // BarcodeDetector + a real camera-shaped device. The latter is the
  // new gate (v0.9.x): desktops with BarcodeDetector but no real camera
  // were sitting on a black <video> for ~2.5 s before the watchdog
  // surfaced the fallback card. Failing fast here flips them straight
  // into the unsupported branch with no black flash.
  const supported = getBarcodeDetector() !== null && hasCameraAffordance();

  // Refs so the camera loop reads the latest closures without
  // re-initialising the camera on every render.
  const onDetectRef = useRef(opts.onDetect);
  const isBlockedRef = useRef(opts.isBlocked);
  onDetectRef.current = opts.onDetect;
  isBlockedRef.current = opts.isBlocked;

  // Tracks the most recent emission for the cooldown.
  const lastEmittedRef = useRef<{ value: string; at: number } | null>(null);

  // Try to dispatch a candidate value. The cooldown is camera-only —
  // the camera lingers on a barcode for many frames per second and
  // would otherwise spam the caller; e2e dispatches are intentional
  // user-triggered events that shouldn't be deduplicated.
  function tryDispatch(rawValue: string, source: 'camera' | 'e2e'): void {
    const value = normalizeEan(rawValue);
    if (value.length === 0) return;
    if (source === 'camera') {
      const now = Date.now();
      const dup =
        lastEmittedRef.current &&
        lastEmittedRef.current.value === value &&
        now - lastEmittedRef.current.at < SAME_VALUE_COOLDOWN_MS;
      if (dup) return;
      lastEmittedRef.current = { value, at: now };
    }
    if (isBlockedRef.current?.()) return;
    onDetectRef.current(value);
  }

  // Camera + BarcodeDetector loop. Runs once at mount when supported.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    let rafId: number | null = null;
    let stream: MediaStream | null = null;
    // Desktop edge case: on platforms where BarcodeDetector exists
    // (recent Chromium on Mac/ChromeOS/Android) but getUserMedia
    // resolves with a stream that never produces frames — no real
    // camera, virtual camera idle, autoplay queued past a missing
    // gesture — the <video> element sits black with no error fired.
    // The watchdog flips to the existing error path after 2.5s if
    // the video metadata hasn't loaded, surfacing the "Camera
    // unavailable" fallback card the caller already renders.
    let watchdog: ReturnType<typeof setTimeout> | null = null;

    const Detector = getBarcodeDetector();
    if (!Detector) return;
    const detector = new Detector({ formats: [...SCAN_FORMATS] });

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();

        watchdog = setTimeout(() => {
          if (cancelled) return;
          const el = videoRef.current;
          if (!el || el.videoWidth === 0) {
            setError('camera unavailable');
          }
        }, 2500);

        const tick = async (): Promise<void> => {
          if (cancelled || !videoRef.current) return;
          if (watchdog !== null && videoRef.current.videoWidth > 0) {
            clearTimeout(watchdog);
            watchdog = null;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0]) {
              tryDispatch(codes[0].rawValue, 'camera');
            }
          } catch {
            // Detector occasionally throws on a black frame.
          }
          rafId = requestAnimationFrame(() => void tick());
        };
        await tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'camera unavailable';
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (watchdog !== null) clearTimeout(watchdog);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
    };
  }, [supported]);

  // e2e CustomEvent listener — only mounted when VITE_E2E. Routes
  // through the same cooldown + isBlocked path as a real scan so test
  // runs see identical semantics. Document-level so seed.ts can
  // dispatch without holding a ref to the screen.
  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return;
    function onE2eScan(ev: Event): void {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      if (!detail?.value) return;
      tryDispatch(detail.value, 'e2e');
    }
    document.addEventListener('inventar:e2e-scan', onE2eScan);
    return () => document.removeEventListener('inventar:e2e-scan', onE2eScan);
  }, []);

  return { videoRef, supported, error };
}
