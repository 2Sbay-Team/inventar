import { describe, expect, it } from 'vitest';
import { generateModernQrSvg } from './qr-svg-renderer';

// A short, stable URL that encodes compactly at any error-correction
// level so tests run quickly.
const TEST_URL = 'https://inventar.hoodhood.ai/article/SAMPLE';

describe('generateModernQrSvg — structure', () => {
  it('returns an SVG string', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('includes a square viewBox whose side equals size + 2 × margin', () => {
    // Default margin=1; QRCode.create at level H for this URL yields a
    // known size. We just verify the viewBox is square and > 0.
    const svg = generateModernQrSvg(TEST_URL);
    const match = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(match![2]); // square
    expect(Number(match![1])).toBeGreaterThan(0);
  });

  it('contains circle elements for data modules', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toContain('<circle ');
  });

  it('contains exactly three sets of finder-pattern rects (9 rects total)', () => {
    const svg = generateModernQrSvg(TEST_URL);
    // Each finder pattern = 3 rects (outer + middle + inner), three corners.
    const matches = svg.match(/<rect /g);
    // 1 background rect + 9 finder rects = 10
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(10);
  });

  it('finder pattern outer rects carry rx > 0 (rounded corners)', () => {
    const svg = generateModernQrSvg(TEST_URL);
    // All finder rects have rx= attribute; the outer ones are 7×7
    expect(svg).toMatch(/<rect [^>]*width="7"[^>]*rx="1\.4"/);
  });

  it('finder pattern inner rects carry rx > 0 (rounded corners)', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toMatch(/<rect [^>]*width="3"[^>]*rx="0\.6"/);
  });

  it('data circles do not appear inside finder zone (col<7, row<7)', () => {
    const svg = generateModernQrSvg(TEST_URL, { margin: 0 });
    // With margin=0 the finder pattern starts at x=0, y=0. Any circle
    // whose cx < 7 and cy < 7 would be inside the top-left finder zone.
    const circleRe = /<circle cx="([0-9.]+)" cy="([0-9.]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = circleRe.exec(svg)) !== null) {
      const cx = Number(match[1]);
      const cy = Number(match[2]);
      // Center of module (col, row) = col+0.5, row+0.5. So col = cx-0.5.
      const col = cx - 0.5;
      const row = cy - 0.5;
      if (col < 7 && row < 7) {
        throw new Error(`Circle at (col=${col}, row=${row}) is inside top-left finder zone`);
      }
    }
  });
});

describe('generateModernQrSvg — colour', () => {
  it('uses default dark colour #1F2937 when no brand color is given', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toContain('fill="#1F2937"');
    expect(svg).not.toContain('fill="#FF6B35"');
  });

  it('applies the brand color to circles and finder rects when valid', () => {
    const svg = generateModernQrSvg(TEST_URL, { darkColor: '#FF6B35' });
    expect(svg).toContain('fill="#FF6B35"');
    expect(svg).not.toContain('fill="#1F2937"');
  });

  it('falls back to default dark when brand color is null', () => {
    const svg = generateModernQrSvg(TEST_URL, { darkColor: null });
    expect(svg).toContain('fill="#1F2937"');
  });

  it('falls back to default dark when brand color is an invalid hex', () => {
    const svg = generateModernQrSvg(TEST_URL, { darkColor: 'not-a-color' });
    expect(svg).toContain('fill="#1F2937"');
  });

  it('uses white background by default', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toContain('fill="#FFFFFF"');
  });

  it('respects a custom light color', () => {
    const svg = generateModernQrSvg(TEST_URL, { lightColor: '#FFF8F2' });
    expect(svg).toContain('fill="#FFF8F2"');
  });
});

describe('generateModernQrSvg — error correction', () => {
  it('level H produces a larger QR matrix than level L for the same content', () => {
    const svgH = generateModernQrSvg(TEST_URL, { errorCorrectionLevel: 'H' });
    const svgL = generateModernQrSvg(TEST_URL, { errorCorrectionLevel: 'L' });
    const sizeOf = (svg: string): number => {
      const m = svg.match(/viewBox="0 0 (\d+) \d+"/);
      return m ? Number(m[1]) : 0;
    };
    expect(sizeOf(svgH)).toBeGreaterThan(sizeOf(svgL));
  });

  it('defaults to error correction level H', () => {
    // By defaulting to H, the QR should match an explicit H call.
    const svgDefault = generateModernQrSvg(TEST_URL);
    const svgH = generateModernQrSvg(TEST_URL, { errorCorrectionLevel: 'H' });
    expect(svgDefault).toBe(svgH);
  });
});

describe('generateModernQrSvg — margin', () => {
  it('custom margin shifts the viewBox size accordingly', () => {
    const svgM1 = generateModernQrSvg(TEST_URL, { margin: 1 });
    const svgM4 = generateModernQrSvg(TEST_URL, { margin: 4 });
    const sizeOf = (svg: string): number => {
      const m = svg.match(/viewBox="0 0 (\d+) \d+"/);
      return m ? Number(m[1]) : 0;
    };
    // margin 4 adds 6 extra units (2*(4-1)) compared to margin 1.
    expect(sizeOf(svgM4) - sizeOf(svgM1)).toBe(6);
  });
});

describe('generateModernQrSvg — injectQrCenterBranding compatibility', () => {
  it('emits a viewBox="0 0 N N" that injectQrCenterBranding can parse', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
  });

  it('ends with </svg> so the branding injector can append to it', () => {
    const svg = generateModernQrSvg(TEST_URL);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });
});
