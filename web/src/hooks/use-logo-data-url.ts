import { useEffect, useState } from 'react';
import { db } from '../db/db';
import { getPhoto, photoToBlob } from '../repos/photos';
import { useProfile } from './use-profile';

// v0.6 ADR-030 — reads the merchant's shop logo from IndexedDB and
// returns it as a base64 data URL (e.g. `data:image/png;base64,…`)
// ready to inline inside an SVG <image href="…"/> element. The QR
// branding helper uses this to stamp the logo in the centre of
// printed labels.
//
//   undefined → still loading (profile or photo not yet resolved)
//   null      → profile loaded but no logo configured (text fallback)
//   string    → data URL ready
export function useLogoDataUrl(): string | null | undefined {
  const profile = useProfile();
  const [dataUrl, setDataUrl] = useState<string | null | undefined>(undefined);
  const logoId = profile?.logo_photo_id ?? null;

  useEffect(() => {
    if (profile === undefined) {
      setDataUrl(undefined);
      return;
    }
    if (logoId === null) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const photo = await getPhoto(db, logoId);
      if (cancelled) return;
      if (!photo) {
        setDataUrl(null);
        return;
      }
      const blob = photoToBlob(photo);
      const reader = new FileReader();
      reader.onload = () => {
        if (cancelled) return;
        setDataUrl(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => {
        if (cancelled) return;
        setDataUrl(null);
      };
      reader.readAsDataURL(blob);
    })();
    return () => {
      cancelled = true;
    };
  }, [profile, logoId]);

  return dataUrl;
}
