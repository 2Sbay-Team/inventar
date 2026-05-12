import { useMemo } from 'react';
import { useProfile } from './use-profile';
import { useLogoDataUrl } from './use-logo-data-url';
import { type QrBrandingOptions } from '../utils/qr-branding';

// v0.6.5 — central QR-branding resolver. Mirrors profile.qr_center_mode
// at the render layer: 'logo' uses the merchant's uploaded logo,
// 'name' uses the shop's display name. Auto-falls back to 'name'
// whenever 'logo' is selected but no logo is available — covers the
// brief window between the merchant deleting their logo and the next
// Settings write (which would normalise qr_center_mode the same way
// via deriveQrCenterMode), plus the in-app render of a stale 'logo'
// row that pre-dates a deletion.
//
// Returns:
//   • undefined while profile / logo are still loading — caller
//     hands undefined to ArticleQR which then renders a plain QR
//     until the resolver resolves.
//   • A populated `QrBrandingOptions` once everything is ready.

export function useQrBranding(): QrBrandingOptions | undefined {
  const profile = useProfile();
  const logoDataUrl = useLogoDataUrl();

  return useMemo(() => {
    if (profile === undefined) return undefined;
    if (profile === null) return undefined;
    // `useLogoDataUrl` returns `undefined` while the IDB read is in
    // flight even when the profile already says a logo is present.
    // Wait for it so we don't flicker the name fallback into the
    // overlay while the bytes are loading.
    if (profile.logo_photo_id && logoDataUrl === undefined) return undefined;
    const mode = profile.qr_center_mode;
    const wantsLogo = mode === 'logo' && profile.logo_photo_id && logoDataUrl;
    return wantsLogo
      ? { logoDataUrl, text: null }
      : { logoDataUrl: null, text: profile.name ?? null };
  }, [profile, logoDataUrl]);
}
