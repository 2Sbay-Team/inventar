import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';

// v0.5.4 ADR-028 — side-by-side preview shown only when the keying
// util produced a candidate. Default selection: transparent (matches
// merchant expectation 90%+ of the time per the design note). Cream-
// theme background under both previews makes any keyed-edge halo
// visible at a glance.

export interface LogoPreviewDialogProps {
  open: boolean;
  // Original compressed JPEG blob the merchant uploaded.
  originalBlob: Blob;
  // Keyed PNG blob produced by analyseLogoForKeying. The dialog only
  // shows when this is non-null (caller's responsibility).
  keyedBlob: Blob;
  // Picked by the merchant: which blob to keep. The caller persists.
  onChoose: (choice: { blob: Blob; kind: 'transparent' | 'original' }) => void;
  onCancel: () => void;
}

export function LogoPreviewDialog({
  open,
  originalBlob,
  keyedBlob,
  onChoose,
  onCancel,
}: LogoPreviewDialogProps): JSX.Element {
  const { t } = useTranslation('logo');
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [keyedUrl, setKeyedUrl] = useState<string | null>(null);

  // Object URLs are revoked on unmount + when the dialog closes so a
  // merchant who opens and dismisses many logos in one session doesn't
  // leak browser memory.
  useEffect(() => {
    if (!open) return;
    const orig = URL.createObjectURL(originalBlob);
    const keyed = URL.createObjectURL(keyedBlob);
    setOriginalUrl(orig);
    setKeyedUrl(keyed);
    return () => {
      URL.revokeObjectURL(orig);
      URL.revokeObjectURL(keyed);
      setOriginalUrl(null);
      setKeyedUrl(null);
    };
  }, [open, originalBlob, keyedBlob]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content
          data-testid="logo-preview-dialog"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <Dialog.Title className="font-display text-lg font-medium">{t('title')}</Dialog.Title>
          <Dialog.Description className="text-ink-3 mt-1 text-xs">
            {t('subtitle')}
          </Dialog.Description>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Tile label={t('label_original')} url={originalUrl} testId="logo-preview-original" />
            <Tile
              label={t('label_transparent')}
              url={keyedUrl}
              testId="logo-preview-transparent"
              checkered
            />
          </div>

          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              data-testid="logo-preview-use-transparent"
              autoFocus
              onClick={() => onChoose({ blob: keyedBlob, kind: 'transparent' })}
              className="bg-accent w-full rounded-xl py-3 text-sm font-semibold text-white shadow-[0_4px_14px_rgba(255,107,53,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              {t('use_transparent')}
            </button>
            <button
              type="button"
              data-testid="logo-preview-keep-original"
              onClick={() => onChoose({ blob: originalBlob, kind: 'original' })}
              className="border-hair w-full rounded-xl border bg-white py-2.5 text-sm font-medium text-ink"
            >
              {t('keep_original')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Tile({
  label,
  url,
  testId,
  checkered,
}: {
  label: string;
  url: string | null;
  testId: string;
  checkered?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        data-testid={testId}
        className={`flex h-32 w-32 items-center justify-center overflow-hidden rounded-xl border ${
          checkered ? 'logo-preview-checker border-hair' : 'border-hair bg-paper'
        }`}
      >
        {url ? (
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        ) : null}
      </div>
      <span className="text-ink-3 text-[10.5px] font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}
