import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface ArticleQRProps {
  articleId: string;
  // Size of the rendered SVG image in CSS px. The QR is generated as
  // a vector so it stays crisp on any zoom level / print resolution.
  size?: number;
  testId?: string;
}

// Renders a QR code that, when scanned with any phone camera, opens the
// article's detail page in the live deployed app. Useful for printing
// shelf labels — staff can scan the tag to jump straight to "Sell" /
// "Restock" without typing the SKU.
export function ArticleQR({ articleId, size = 128, testId }: ArticleQRProps): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Hard-code the production origin so a printed label keeps working
    // even when scanned offline by a phone whose camera doesn't know we
    // were on localhost during dev. If the QR is generated against
    // localhost, the scan opens an unreachable URL.
    const url = `https://inventar.hoodhood.ai/article/${articleId}`;
    void QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#1F2937', light: '#FFFFFF' },
    }).then((svgString) => {
      if (cancelled) return;
      setSvg(svgString);
    });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

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
