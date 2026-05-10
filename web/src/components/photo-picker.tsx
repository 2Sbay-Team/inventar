import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Image as ImageIcon } from 'lucide-react';

// v0.5.1: explicit camera + gallery buttons. The previous single
// <input type="file" accept="image/*"> relied on every Android
// Chrome to surface BOTH a camera option AND a gallery option in
// its picker — most do, but on certain devices (older Honor /
// Huawei builds we've seen) the picker ONLY opens the camera and
// the merchant has no obvious way to pick an existing photo.
//
// This component splits the action into two explicit buttons. The
// camera input gets capture="environment" so Android opens the
// camera straight away; the gallery input has NO capture so the OS
// shows whatever picker it prefers (almost always a gallery /
// recent photos sheet on modern Androids).
//
// Test compatibility: the gallery input keeps the existing
// `${testIdBase}-input` testid so playwright's setInputFiles call
// site doesn't move. The camera input uses `${testIdBase}-input-camera`.
//
// Props mirror what the previous <label + input> pattern needed:
//   testIdBase — prefix used to derive all stable test IDs.
//   onFile     — called with the selected File.
//   layout     — 'compact' renders the two buttons as a small row of
//                pill buttons (used for Add Article block CTAs);
//                'stacked' uses full-width vertical buttons (used for
//                Settings / Onboarding logo, where vertical space is
//                cheap).

interface PhotoPickerProps {
  testIdBase: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  layout?: 'compact' | 'stacked';
}

export function PhotoPicker({
  testIdBase,
  onFile,
  disabled = false,
  layout = 'compact',
}: PhotoPickerProps): JSX.Element {
  const { t } = useTranslation('common');
  // v0.5.2.1: inputs use `sr-only` (visually hidden but in the layout)
  // instead of `hidden` (display: none). Webkit's setInputFiles in tests
  // — and some real iOS Safari edge cases — silently no-op on
  // display:none inputs because the browser treats them as detached.
  // sr-only keeps the input addressable while invisible to users.
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (file) onFile(file);
    // Reset so picking the SAME file twice in a row still fires onChange.
    e.target.value = '';
  }

  const isCompact = layout === 'compact';
  const containerClass = isCompact ? 'flex gap-2' : 'flex flex-col gap-2';
  const btnClass = isCompact
    ? 'border-hair text-ink-2 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-xs disabled:opacity-50'
    : 'border-hair text-ink-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-white px-3 py-3 text-sm disabled:opacity-50';

  return (
    <>
      <div className={containerClass}>
        <button
          type="button"
          data-testid={`${testIdBase}-camera`}
          onClick={() => cameraRef.current?.click()}
          disabled={disabled}
          className={btnClass}
        >
          <Camera aria-hidden className="h-4 w-4" strokeWidth={2} />
          {t('photo_take')}
        </button>
        <button
          type="button"
          data-testid={`${testIdBase}-gallery`}
          onClick={() => galleryRef.current?.click()}
          disabled={disabled}
          className={btnClass}
        >
          <ImageIcon aria-hidden className="h-4 w-4" strokeWidth={2} />
          {t('photo_gallery')}
        </button>
      </div>
      <input
        ref={cameraRef}
        data-testid={`${testIdBase}-input-camera`}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
        onChange={handleChange}
      />
      <input
        ref={galleryRef}
        data-testid={`${testIdBase}-input`}
        type="file"
        accept="image/*"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
        onChange={handleChange}
      />
    </>
  );
}
