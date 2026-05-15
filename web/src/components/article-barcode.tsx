import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

interface ArticleBarcodeProps {
  code: string;
  forceBlack?: boolean;
  width?: number;
  height?: number;
  testId?: string;
}

export function ArticleBarcode({
  code,
  forceBlack = true,
  width = 1.5,
  height = 50,
  testId,
}: ArticleBarcodeProps): JSX.Element {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !code.trim()) return;
    try {
      JsBarcode(ref.current, code, {
        format: 'CODE128',
        width,
        height,
        displayValue: false,
        background: '#FFFFFF',
        lineColor: forceBlack ? '#000000' : '#000000',
        margin: 0,
      });
    } catch {
      // Invalid input — leave the SVG empty rather than throwing.
    }
  }, [code, width, height, forceBlack]);

  return (
    <svg
      ref={ref}
      data-testid={testId ?? `article-barcode-${code}`}
      aria-label={`Barcode ${code}`}
    />
  );
}
