import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { injectQrCenterBranding, type QrBrandingOptions } from '../utils/qr-branding';
import { getSafeQrColor } from '../utils/contrast';

// Exported for testing — encapsulates the forceBlack/brand-color decision.
export function getQrDarkColor(brandColor: string | null | undefined, forceBlack: boolean): string {
  return forceBlack ? '#000000' : getSafeQrColor(brandColor);
}

interface ArticleQRProps {
  articleId: string;
  // Size of the rendered SVG image in CSS px. The QR is generated as
  // a vector so it stays crisp on any zoom level / print resolution.
  size?: number;
  testId?: string;
  // v0.6 ADR-030 — optional center-overlay branding (logo or store
  // name). Only the printed label sets this; the in-app Article
  // Detail QR dialog leaves it undefined so its QR stays plain for
  // fastest in-app scanning.
  branding?: QrBrandingOptions;
  // Optional brand colour for the QR dark modules. Pale colours are
  // automatically rejected by getSafeQrColor() so labels stay scannable.
  brandColor?: string | null;
  // When true, forces pure black (#000000) regardless of brandColor.
  // Used by the print flow so physical labels use black ink only.
  forceBlack?: boolean;
  // Optional tap feedback/action for future scanner-style cards. This is
  // implemented with CSS only; no motion dependency is required.
  onScan?: () => void;
  interactive?: boolean;
}

// Renders a QR code that, when scanned with any phone camera, opens the
// article's detail page in the live deployed app. Useful for printing
// shelf labels — staff can scan the tag to jump straight to "Sell" /
// "Restock" without typing the SKU.
export function ArticleQR({
  articleId,
  size = 128,
  testId,
  branding,
  brandColor,
  forceBlack = false,
  onScan,
  interactive = false,
}: ArticleQRProps): JSX.Element {
  const [rawSvg, setRawSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Hard-code the production origin so a printed label keeps working
    // even when scanned offline by a phone whose camera doesn't know we
    // were on localhost during dev. If the QR is generated against
    // localhost, the scan opens an unreachable URL.
    const url = `https://inventar.hoodhood.ai/article/${articleId}`;
    void QRCode.toString(url, {
      type: 'svg',
      // Level H gives the strongest recovery budget for optional center
      // branding. The safe colour utility keeps contrast high for scanners.
      errorCorrectionLevel: 'H',
      margin: 1,
      color: { dark: getQrDarkColor(brandColor, forceBlack), light: '#FFFFFF' },
    }).then((svgString) => {
      if (cancelled) return;
      setRawSvg(svgString);
    });
    return () => {
      cancelled = true;
    };
  }, [articleId, brandColor, forceBlack]);

  // Apply branding on top of the raw QR SVG. Cheap (regex + string
  // concat) so re-running on every render is fine when the parent
  // hasn't memoised the branding object.
  const svg = useMemo(() => {
    if (!rawSvg) return null;
    return branding ? injectQrCenterBranding(rawSvg, branding) : rawSvg;
  }, [rawSvg, branding]);

  const qrContent = (
    <div
      data-testid={testId ?? 'article-qr'}
      style={{ width: size, height: size }}
      className="rounded-lg bg-white p-1 shadow-sm"
      // QR string is generated locally from a known-safe URL, never user
      // input, so dangerouslySetInnerHTML is appropriate here.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );

  if (!interactive) return qrContent;

  return (
    <button
      type="button"
      onClick={onScan}
      className="rounded-lg transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      aria-label={`Open article QR for ${articleId}`}
    >
      {qrContent}
    </button>
  );
}
