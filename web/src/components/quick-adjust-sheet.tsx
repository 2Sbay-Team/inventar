import * as Dialog from '@radix-ui/react-dialog';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../hooks/use-locale';
import { formatNumber } from '../i18n/format-number';
import { db } from '../db/db';
import { recordMovement } from '../repos/movements';
import { type MovementType, type UUID } from '../types';

export interface QuickAdjustTarget {
  variantId: UUID;
  size: string;
  articleName: string;
  currentQty: number;
}

interface QuickAdjustSheetProps {
  open: boolean;
  target: QuickAdjustTarget | null;
  // Caller controls whether the action defaults to a sell (− Sell button) or
  // a restock (+ Restock); also drives which radio option is preselected.
  defaultReason?: MovementType;
  onClose: () => void;
}

// SPEC §2.4 labels them Sale / Return / Adjustment / Restock; DATA_MODEL §2
// stores `purchase` as the type for restock (a restock IS a purchase). The
// i18n key set therefore includes `reason_purchase` aliasing "Restock".
const REASONS: ReadonlyArray<{ key: MovementType; sign: 1 | -1 }> = [
  { key: 'sale', sign: -1 },
  { key: 'return', sign: 1 },
  { key: 'adjustment', sign: 1 },
  { key: 'purchase', sign: 1 },
];

export function QuickAdjustSheet({
  open,
  target,
  defaultReason = 'sale',
  onClose,
}: QuickAdjustSheetProps): JSX.Element | null {
  const { t } = useTranslation('adjust');
  const { t: tCommon } = useTranslation('common');
  const { locale } = useLocale();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState<MovementType>(defaultReason);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setReason(defaultReason);
      setNote('');
    }
  }, [open, defaultReason]);

  if (!target) return null;

  async function confirm(): Promise<void> {
    if (!target) return;
    setSubmitting(true);
    const sign = REASONS.find((r) => r.key === reason)?.sign ?? -1;
    await recordMovement(db, {
      variant_id: target.variantId,
      delta: sign * step,
      type: reason,
      note: note.trim() === '' ? null : note.trim(),
    });
    setSubmitting(false);
    onClose();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content
          data-testid="quick-adjust-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <Dialog.Title className="font-display text-lg font-medium">
            {t('title', { size: target.size, name: target.articleName })}
          </Dialog.Title>
          <p data-testid="adjust-current" className="text-ink-3 mt-1 font-mono text-xs">
            {t('current', { n: formatNumber(target.currentQty, locale) })}
          </p>

          <div
            data-testid="adjust-stepper"
            className="border-hair mt-4 flex items-center rounded-xl border bg-white p-2"
          >
            <button
              type="button"
              data-testid="stepper-minus"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="bg-paper border-hair h-8 w-8 rounded-lg border text-base"
            >
              −
            </button>
            <span
              data-testid="stepper-value"
              className="flex-1 text-center font-mono text-sm font-semibold tabular-nums"
            >
              {formatNumber(step, locale)}
            </span>
            <button
              type="button"
              data-testid="stepper-plus"
              onClick={() => setStep((s) => s + 1)}
              className="bg-paper border-hair h-8 w-8 rounded-lg border text-base"
            >
              +
            </button>
          </div>

          <RadioGroup.Root
            data-testid="adjust-reason"
            value={reason}
            onValueChange={(v) => setReason(v as MovementType)}
            className="mt-4 grid grid-cols-2 gap-2"
          >
            {REASONS.map((r) => (
              <RadioGroup.Item
                key={r.key}
                value={r.key}
                data-testid={`reason-${r.key}`}
                className="data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft border-hair text-ink rounded-lg border bg-white px-3 py-2 text-start text-sm"
              >
                {t(`reason_${r.key}`)}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>

          <input
            data-testid="adjust-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('note_placeholder')}
            className="border-hair mt-4 w-full rounded-xl border bg-white px-3 py-2 text-sm"
          />

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              data-testid="adjust-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-3 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="adjust-confirm"
              disabled={submitting}
              onClick={() => void confirm()}
              className="bg-ink flex-1 rounded-xl py-3 text-sm text-white disabled:opacity-50"
            >
              {tCommon('confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
