// Lightweight feature-flag system backed by localStorage.
// Defaults all ship as false so new features are dark until a dev or
// test explicitly flips them. Any flag not in DEFAULTS returns false.
//
// Browser: reads localStorage key `ff_<flag>` ('true' / 'false').
// Server / test / SSR: falls through to the compiled default.

const DEFAULTS: Readonly<Record<string, boolean>> = {
  // Enables ModernQRCode (qr-code-styling) instead of the custom SVG
  // renderer. Enabled for all users after N+9 automated scan test passed.
  modern_qr_style: true,
};

export function flagEnabled(flag: string): boolean {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(`ff_${flag}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  }
  return DEFAULTS[flag] ?? false;
}

export function setFlag(flag: string, enabled: boolean): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(`ff_${flag}`, String(enabled));
  }
}

export function clearFlag(flag: string): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`ff_${flag}`);
  }
}
