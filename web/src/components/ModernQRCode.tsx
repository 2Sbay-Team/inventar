// Modern QR code component backed by qr-code-styling (v1.9.x).
// Used when the `modern_qr_style` feature flag is enabled; the existing
// ArticleQR / qr-svg-renderer path remains the fallback.
//
// Visual options (per brief):
//   - dotsOptions.type = 'rounded'          (soft rectangular dots)
//   - cornersSquareOptions.type = 'extra-rounded'  (~20 % border-radius)
//   - cornersDotOptions.type = 'dot'        (circular inner square)
//   - errorCorrectionLevel = 'H'            (30 % damage tolerance)
//   - brand color → contrast-checked; falls back to #000000 if too light
//   - centre image = logo URL, or a generated SVG badge for store name
//
// Rendering note — qr-code-styling's update() clears the container but
// does NOT re-append the SVG element afterwards. So calling update() on
// a mounted instance leaves the container empty. We work around this by
// always creating a fresh QRCodeStyling instance and calling append() on
// every render (clearing any previous SVG first). The instance is
// lightweight to construct and drawQR() resolves as a microtask so there
// is no visible flash.

import { useEffect, useRef } from 'react';
import QRCodeStyling from 'qr-code-styling';
import { getSafeQrColor } from '../utils/color-contrast';
import { truncateForBranding } from '../utils/qr-branding';

export interface ModernQRCodeProps {
  // The URL / string to encode.
  value: string;
  // Merchant brand hex. Contrast-checked; falls back to black if too light.
  brandColor?: string | null;
  // Data URL for a logo to render in the centre. Takes precedence over
  // centerText when both are supplied.
  logoUrl?: string | null;
  // Store name fallback when no logo is available. Rendered as a small
  // SVG badge and placed in the centre (truncated to 12 chars).
  centerText?: string | null;
  // Canvas / SVG output size in px. Default 200.
  size?: number;
  // data-testid for the outer container div.
  testId?: string;
  // When true, forces pure black (#000000) regardless of brandColor.
  // Used by the print flow so physical labels use black ink only.
  forceBlack?: boolean;
}

// Encode a short text label as an SVG data URL so it can be passed to
// qr-code-styling's `image` option (which only accepts URLs).
function textToSvgDataUrl(text: string): string {
  const display = truncateForBranding(text);
  // Escape XML metacharacters for safe SVG embedding.
  const safe = display
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 28">` +
    `<text x="40" y="14" text-anchor="middle" dominant-baseline="central"` +
    ` font-family="ui-sans-serif,system-ui,-apple-system,sans-serif"` +
    ` font-size="14" font-weight="600" fill="#1F2937">${safe}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export function ModernQRCode({
  value,
  brandColor,
  logoUrl,
  centerText,
  size = 200,
  testId,
  forceBlack = false,
}: ModernQRCodeProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep a ref to the current QRCodeStyling instance so we can clean up.
  const qrRef = useRef<QRCodeStyling | null>(null);

  const dark = forceBlack ? '#000000' : getSafeQrColor(brandColor ?? null);
  const centerImage: string | undefined =
    logoUrl ?? (centerText ? textToSvgDataUrl(centerText) : undefined);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Always build a fresh instance — qr-code-styling's update() clears
    // the container but does not re-append the new SVG, leaving a blank
    // div. Re-creating is cheap: the QR data calculation is O(n²) in
    // module count and drawQR resolves as a microtask.
    container.innerHTML = '';
    const qr = new QRCodeStyling({
      type: 'svg',
      width: size,
      height: size,
      data: value,
      image: centerImage,
      dotsOptions: { type: 'rounded', color: dark },
      cornersSquareOptions: { type: 'extra-rounded', color: dark },
      cornersDotOptions: { type: 'dot', color: dark },
      backgroundOptions: { color: '#FFFFFF' },
      imageOptions: { hideBackgroundDots: true, imageSize: 0.25, margin: 4 },
      qrOptions: { errorCorrectionLevel: 'H' },
    });
    qr.append(container);
    qrRef.current = qr;

    return () => {
      // Clear the container and drop the reference so the next effect
      // always starts from a clean slate (important for Strict Mode's
      // simulated unmount/remount cycle).
      container.innerHTML = '';
      qrRef.current = null;
    };
  }, [value, dark, centerImage, size]);

  return (
    <div
      ref={containerRef}
      data-testid={testId ?? 'modern-qr'}
      data-generator="modern"
      data-qr-ecl="H"
      style={{ width: size, height: size }}
    />
  );
}
