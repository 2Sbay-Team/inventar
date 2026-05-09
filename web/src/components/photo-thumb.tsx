import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { db } from '../db/db';
import { getPhoto } from '../repos/photos';
import { type UUID } from '../types';

interface PhotoThumbProps {
  photoId: UUID | null;
  size?: number;
  className?: string;
  testId?: string;
}

// Renders a Photo Blob as a thumbnail. Object URLs are revoked on unmount so
// long-lived sessions don't accumulate them.
export function PhotoThumb({
  photoId,
  size = 56,
  className = '',
  testId,
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
      createdUrl = URL.createObjectURL(photo.blob);
      setUrl(createdUrl);
    })();
    return () => {
      revoked = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [photoId]);

  return (
    <div
      data-testid={testId ?? 'photo-thumb'}
      className={`bg-paper-deep border-hair flex items-center justify-center overflow-hidden rounded-xl border ${className}`}
      style={{ width: size, height: size }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <ImageIcon aria-hidden className="text-ink-4 h-5 w-5" strokeWidth={1.75} />
      )}
    </div>
  );
}
