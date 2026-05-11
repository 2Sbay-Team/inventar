// v0.6 ADR-027 — center-overlay branding for printed QR labels.
//
// The qrcode lib (v1.5.x) emits an SVG with a fixed structure:
//   <svg ... viewBox="0 0 N N" ...>
//     <path fill="#FFFFFF" d="..."/>   ← quiet zone
//     <path fill="..." d="..."/>       ← QR modules
//   </svg>
//
// To "stamp" branding in the centre we inject one of two pairs of
// child elements right before the closing </svg> tag:
//   • `<image>` element (when a logo data URL is supplied), backed by
//     a small white `<rect>` so the QR modules don't bleed through the
//     transparent edges of the logo
//   • `<rect>` + `<text>` (when only a store name is supplied)
//
// The center overlay covers exactly `edgeFraction` × `edgeFraction` of
// the QR's edge — defaults to 0.22, in line with what error correction
// level Q (≤ 25 % obscured-area recovery) handles reliably on real
// retail-print labels.

export interface QrBrandingOptions {
  // Edge fraction (0..1) of the centered branding area. Both dimensions.
  // Larger than ~0.25 starts to risk scan failures even at level Q.
  edgeFraction?: number;
  // Logo as a data URL (data:image/...;base64,...). Takes precedence
  // over `text` when both are supplied. Pass `null` to fall back.
  logoDataUrl?: string | null;
  // Store name / arbitrary text drawn in the centre when no logo is
  // available. Truncated to `maxTextLength` with an ellipsis.
  text?: string | null;
  // Max character count before ellipsis truncation. Defaults to 12.
  maxTextLength?: number;
}

const DEFAULT_EDGE_FRACTION = 0.22;
const DEFAULT_MAX_TEXT_LENGTH = 12;

// Pulls the viewBox dimensions out of the qrcode lib's SVG output.
// Returns null if we can't find one — the caller falls back to
// emitting the SVG unchanged so a malformed input can never crash the
// print path.
function extractSquareViewBox(svg: string): number | null {
  const match = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  // Square QR — sanity check; the lib never emits non-square but be
  // defensive against a future change.
  if (Math.abs(w - h) > 0.01) return null;
  return w;
}

// XML-escape a short string for safe inclusion inside `<text>` and
// element attribute values. We don't need a full HTML escape — the
// branding strings are merchant-supplied shop names, never markup.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function truncateForBranding(text: string, maxLength = DEFAULT_MAX_TEXT_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  // Reserve one slot for the ellipsis so the visible length stays
  // ≤ maxLength. Use the single-character "…" rather than three dots
  // so the rendered glyph stays narrow.
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

// Returns the SVG with center-branding overlay child elements
// appended. Pass-through (no mutation) when neither a logoDataUrl nor
// a text fallback is supplied, or when the viewBox can't be parsed.
export function injectQrCenterBranding(svg: string, opts: QrBrandingOptions = {}): string {
  const edgeFraction = opts.edgeFraction ?? DEFAULT_EDGE_FRACTION;
  const maxTextLength = opts.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const logoDataUrl = opts.logoDataUrl ?? null;
  const text = opts.text ?? null;
  if (!logoDataUrl && !text) return svg;
  const edge = extractSquareViewBox(svg);
  if (edge === null) return svg;
  const overlayEdge = edge * edgeFraction;
  const x = (edge - overlayEdge) / 2;
  const y = x; // square — same offset on both axes
  // Add a tiny padding ring of QR-background colour (white) around
  // the logo so the dark modules can't peek out at the corners of a
  // logo with transparency. Half the overlay edge × 1.06 fits within
  // the spec's 22 % tolerance budget on level Q.
  const padding = overlayEdge * 0.06;
  const backgroundEdge = overlayEdge + padding * 2;
  const backgroundX = x - padding;
  const backgroundY = y - padding;
  const overlay: string[] = [];
  overlay.push(
    `<rect x="${backgroundX}" y="${backgroundY}" width="${backgroundEdge}" height="${backgroundEdge}" fill="#FFFFFF"/>`,
  );
  if (logoDataUrl) {
    // `preserveAspectRatio="xMidYMid meet"` letterboxes the logo so a
    // non-square asset still fits inside the reserved overlay area.
    overlay.push(
      `<image x="${x}" y="${y}" width="${overlayEdge}" height="${overlayEdge}" preserveAspectRatio="xMidYMid meet" href="${escapeXml(logoDataUrl)}"/>`,
    );
  } else if (text) {
    const display = truncateForBranding(text, maxTextLength);
    // Font size: tuned so a 12-char string fits inside the overlay at
    // edgeFraction 0.22 on a 31-module QR (viewBox edge ~33). Scales
    // linearly with the overlay edge so smaller QRs stay legible.
    const fontSize = overlayEdge * 0.32;
    overlay.push(
      `<text x="${edge / 2}" y="${edge / 2}" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="${fontSize}" font-weight="600" fill="#1F2937" text-anchor="middle" dominant-baseline="central">${escapeXml(display)}</text>`,
    );
  }
  return svg.replace(/<\/svg>\s*$/, `${overlay.join('')}</svg>`);
}
