// v0.9 Phase 6 — Share-as-image for the Shop Identity business card.
//
// The card itself is a normal piece of HTML laid out with inline
// styles only (Tailwind classes WON'T survive serialisation; the
// foreignObject SVG below has no access to the page's stylesheets).
// We snapshot the live DOM node, wrap it in an `<svg><foreignObject>`,
// rasterise to a 2× canvas, and emit a PNG blob.
//
// Output: a PNG blob the caller can hand to either:
//   * navigator.share({ files: [...] })  — modern Android + Safari
//   * a download fallback                — desktop Chrome, etc.
//
// Returns the chosen path so the UI can toast the appropriate
// success message ("Shared" vs "Downloaded").

export type ShareResult = 'shared' | 'downloaded' | 'cancelled';

export interface ShareBusinessCardOptions {
  // The on-page card DOM node. Must be in the document at the time
  // of capture so getBoundingClientRect returns the rendered size.
  node: HTMLElement;
  // Visible filename when the merchant takes the download fallback.
  filename: string;
  // Toast strings the caller provides per locale — keeps this helper
  // locale-agnostic. Optional; defaults are English fallbacks.
  shareTitle?: string;
  shareText?: string;
}

// Renders `node` to a PNG blob via SVG foreignObject + canvas. Pure
// async — no toast / DOM-injection side effects beyond the temporary
// in-memory Image and canvas this function manages itself.
export async function captureBusinessCardPng(node: HTMLElement): Promise<Blob> {
  const rect = node.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width));
  const cssHeight = Math.max(1, Math.round(rect.height));
  // 2× pixel ratio so the output reads crisp on retina + WhatsApp's
  // re-compression. Hard-cap at 1600 wide to keep the PNG under a
  // few hundred KB for the share sheet.
  const scale = Math.min(2, Math.floor(1600 / cssWidth) || 1);
  const pxWidth = cssWidth * scale;
  const pxHeight = cssHeight * scale;

  // Clone the DOM so we don't have to worry about react re-renders
  // mutating the live node between serialise and rasterise. The
  // clone is detached; foreignObject only reads its serialised
  // markup, so attachment doesn't matter.
  const clone = node.cloneNode(true) as HTMLElement;
  // outerHTML on a cloned node misses the XML namespace foreignObject
  // demands. Serialiser does the heavy lifting.
  const serialiser = new XMLSerializer();
  const xhtml = serialiser
    .serializeToString(clone)
    // Strip any data-testid attrs so the exported image doesn't
    // bleed test instrumentation into the merchant's share.
    .replace(/\s+data-testid="[^"]*"/g, '');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cssWidth}" height="${cssHeight}" viewBox="0 0 ${cssWidth} ${cssHeight}">` +
    `<foreignObject width="100%" height="100%">` +
    // The xhtml namespace decl on a wrapping div is the magic that
    // makes Chrome / Safari accept the inner HTML inside foreignObject.
    `<div xmlns="http://www.w3.org/1999/xhtml">${xhtml}</div>` +
    `</foreignObject>` +
    `</svg>`;

  // SVG data URLs are the safest cross-browser path. Using a Blob
  // URL works on Chrome but races on Safari iOS — the data URL
  // route avoids that timing entirely at the cost of base64 inflation,
  // which is fine for the ~10 KB business card.
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = (err) =>
      reject(err instanceof Event ? new Error('image load failed') : new Error(String(err)));
    image.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, cssWidth, cssHeight);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('toBlob returned null'));
      },
      'image/png',
      0.95,
    );
  });
}

// Top-level entry point. Captures the card, then picks Web Share API
// if available, otherwise downloads. Returns 'cancelled' when the
// merchant aborts the OS share sheet.
export async function shareBusinessCard(options: ShareBusinessCardOptions): Promise<ShareResult> {
  const blob = await captureBusinessCardPng(options.node);
  const file = new File([blob], options.filename, { type: 'image/png' });

  // navigator.share with `files` is supported on Android Chrome,
  // iOS Safari 16+, and a handful of mobile browsers. canShare with
  // the files arg is the canonical "can I share this exact thing"
  // probe — feature-test instead of UA-sniffing.
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: options.shareTitle,
        text: options.shareText,
      });
      return 'shared';
    } catch (err) {
      // AbortError = merchant tapped Cancel on the share sheet.
      // Anything else is unexpected; surface for debugging and fall
      // through to the download path so the merchant still gets
      // their image.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      console.error('[share-business-card] navigator.share failed', err);
    }
  }

  // Fallback: trigger a browser download. Works everywhere.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Defer revocation past the download dispatch so Firefox doesn't
  // abort the navigation. 60s is generous; the browser holds the
  // URL alive in its download manager regardless.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
