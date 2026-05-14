import { useEffect, useMemo, useState } from 'react';
import { generateModernQrSvg } from '../utils/qr-svg-renderer';
import { injectQrCenterBranding, type QrBrandingOptions } from '../utils/qr-branding';

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
  // Merchant brand color (hex). When set, QR dots and finder patterns
  // render in this color instead of the default dark ink.
  brandColor?: string | null;
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
}: ArticleQRProps): JSX.Element {
  const [rawSvg, setRawSvg] = useState<string | null>(null);

  useEffect(() => {
    // Hard-code the production origin so a printed label keeps working
    // even when scanned offline by a phone whose camera doesn't know we
    // were on localhost during dev. If the QR is generated against
    // localhost, the scan opens an unreachable URL.
    const url = `https://inventar.hoodhood.ai/article/${articleId}`;
    // Error correction level H (30 % tolerance) keeps the centre
    // branding overlay (≤ 22 % edge) well within the scanner's budget.
    setRawSvg(generateModernQrSvg(url, { darkColor: brandColor, errorCorrectionLevel: 'H' }));
  }, [articleId, brandColor]);

  // Apply branding on top of the raw QR SVG. Cheap (regex + string
  // concat) so re-running on every render is fine when the parent
  // hasn't memoised the branding object.
  const svg = useMemo(() => {
    if (!rawSvg) return null;
    return branding ? injectQrCenterBranding(rawSvg, branding) : rawSvg;
  }, [rawSvg, branding]);

  return (
    <div
      data-testid={testId ?? 'article-qr'}
      style={{ width: size, height: size }}
      className="bg-white p-1"
      // QR string is generated locally from a known-safe URL, never user
      // input, so dangerouslySetInnerHTML is appropriate here.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
