import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { db } from '../db/db';
import { getPhoto, photoToBlob } from '../repos/photos';
import { type UUID } from '../types';

interface PhotoThumbProps {
  photoId: UUID | null;
  size?: number;
  className?: string;
  testId?: string;
  // v0.6.2 — when true, drop the cream-paper backdrop + border and
  // switch the <img> to object-contain. Logo callers (shop header,
  // Settings preview) pass `transparent` so the keyed PNG sits on
  // the surrounding context with no visible "box". Without this,
  // the bg-paper-deep container shows through transparent PNG
  // edges, producing the cream/peach "box" merchants reported
  // after picking "Use transparent" in the v0.5.4 ADR-028 keying
  // dialog. Article-photo callers keep the default styling — the
  // backdrop is the placeholder while the JPEG loads.
  transparent?: boolean;
}

// Renders a Photo Blob as a thumbnail. Object URLs are revoked on unmount so
// long-lived sessions don't accumulate them.
export function PhotoThumb({
  photoId,
  size = 56,
  className = '',
  testId,
  transparent = false,
}: PhotoThumbProps): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let createdUrl: string | null = null;
    if (!photoId) {
      setUrl(null);
      return;
    }
    void (async () => {
      const photo = await getPhoto(db, photoId);
      if (!photo) return;
      if (revoked) return;
      createdUrl = URL.createObjectURL(photoToBlob(photo));
      setUrl(createdUrl);
    })();
    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoId]);

  // In transparent mode the rounded-xl + border are dropped (they
  // have no visual effect without a backdrop) and the <img> uses
  // object-contain so a non-square logo isn't cropped. The caller's
  // className still applies — shop-header passes 'rounded-full' for
  // both modes and we honour it.
  const containerClass = transparent
    ? `flex items-center justify-center overflow-hidden ${className}`
    : `bg-paper-deep border-hair flex items-center justify-center overflow-hidden rounded-xl border ${className}`;
  const imgClass = transparent ? 'h-full w-full object-contain' : 'h-full w-full object-cover';
  return (
    <div
      data-testid={testId ?? 'photo-thumb'}
      className={containerClass}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className={imgClass} />
      ) : (
        <ImageIcon aria-hidden className="text-ink-4 h-5 w-5" strokeWidth={1.75} />
      )}
    </div>
  );
}
