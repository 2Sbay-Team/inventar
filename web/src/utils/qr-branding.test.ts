import { describe, expect, it } from 'vitest';
import { injectQrCenterBranding, truncateForBranding } from './qr-branding';

// v0.6 ADR-027 — pure DOM/string tests for the QR-branding helper.
// Integration coverage (jsQR-decoded round-trip through the printed
// label flow) lives in the playwright spec.

const SAMPLE_QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" shape-rendering="crispEdges">' +
  '<path fill="#FFFFFF" d="M0,0 h33v33H0z"/>' +
  '<path fill="#1F2937" d="M4,4h1v1H4z"/>' +
  '</svg>';

describe('truncateForBranding', () => {
  it('returns the input unchanged when within the cap', () => {
    expect(truncateForBranding('Hood Hood', 12)).toBe('Hood Hood');
  });

  it('trims surrounding whitespace before measuring', () => {
    expect(truncateForBranding('   Boutique   ', 12)).toBe('Boutique');
  });

  it('truncates with an ellipsis so the rendered length stays ≤ cap', () => {
    expect(truncateForBranding('Royal Babouche Tunis', 12)).toBe('Royal Babou…');
  });

  it('uses the default cap of 12 when none is supplied', () => {
    expect(truncateForBranding('AlphaBetaGamma')).toBe('AlphaBetaGa…');
  });
});

describe('injectQrCenterBranding — no-op cases', () => {
  it('passes the SVG through unchanged when neither logo nor text is provided', () => {
    expect(injectQrCenterBranding(SAMPLE_QR_SVG, {})).toBe(SAMPLE_QR_SVG);
  });

  it('passes the SVG through unchanged when the viewBox cannot be parsed', () => {
    const garbled = '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>';
    expect(injectQrCenterBranding(garbled, { text: 'X' })).toBe(garbled);
  });

  it('passes through when both logo and text are explicitly null', () => {
    expect(injectQrCenterBranding(SAMPLE_QR_SVG, { logoDataUrl: null, text: null })).toBe(
      SAMPLE_QR_SVG,
    );
  });
});

describe('injectQrCenterBranding — logo branch', () => {
  it('injects an <image> at the center 22 % edge when a logo data URL is supplied', () => {
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, {
      logoDataUrl: 'data:image/png;base64,iVBORw0KG',
    });
    // White background rect underneath the logo (so logo transparency
    // doesn't reveal the QR modules at the edges).
    expect(out).toMatch(/<rect[^/]*fill="#FFFFFF"/);
    // The image itself, with the supplied data URL inlined.
    expect(out).toMatch(/<image[^/]*href="data:image\/png;base64,iVBORw0KG"/);
    // preserveAspectRatio so non-square logos letterbox cleanly.
    expect(out).toMatch(/preserveAspectRatio="xMidYMid meet"/);
    // Geometry: viewBox edge is 33, overlay edge is 33 × 0.22 = 7.26,
    // centered at (33-7.26)/2 = 12.87. Don't pin the float exactly —
    // just confirm it's inside the centre quadrant.
    const xMatch = out.match(/<image[^/]*x="([0-9.]+)"/);
    expect(xMatch).not.toBeNull();
    const x = Number(xMatch![1]);
    expect(x).toBeGreaterThan(33 / 4);
    expect(x).toBeLessThan(33 / 2);
  });

  it('logo wins when both logo and text are provided', () => {
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, {
      logoDataUrl: 'data:image/png;base64,AAAA',
      text: 'Boutique',
    });
    expect(out).toContain('<image');
    expect(out).not.toContain('<text');
  });
});

describe('injectQrCenterBranding — text fallback', () => {
  it('injects a centered <text> element when no logo is available', () => {
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, { text: 'Hood Hood' });
    expect(out).toMatch(/<text[^>]*text-anchor="middle"[^>]*>Hood Hood<\/text>/);
    expect(out).toMatch(/dominant-baseline="central"/);
    expect(out).not.toContain('<image');
  });

  it('truncates the rendered text to 12 chars with an ellipsis', () => {
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, { text: 'Royal Babouche Tunis' });
    expect(out).toMatch(/>Royal Babou…</);
    expect(out).not.toContain('Royal Babouche Tunis');
  });

  it('escapes XML metacharacters in the store name', () => {
    // Short enough that no truncation kicks in — this test isolates
    // the XML-escaping behaviour from the ellipsis path.
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, { text: "<O'R&>" });
    expect(out).toContain('&lt;O&apos;R&amp;&gt;');
  });
});

describe('injectQrCenterBranding — edge fraction', () => {
  it('respects a custom edge fraction', () => {
    const out = injectQrCenterBranding(SAMPLE_QR_SVG, {
      logoDataUrl: 'data:image/png;base64,x',
      edgeFraction: 0.3,
    });
    // Overlay edge = 33 * 0.3 = 9.9. Centered at (33-9.9)/2 = 11.55.
    const widthMatch = out.match(/<image[^/]*width="([0-9.]+)"/);
    expect(widthMatch).not.toBeNull();
    expect(Number(widthMatch![1])).toBeCloseTo(9.9, 3);
  });
});
