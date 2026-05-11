import * as Dialog from '@radix-ui/react-dialog';
import * as RadioGroup from '@radix-ui/react-radio-group';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { formatCurrency } from '../i18n/format-currency';
import { formatNumber } from '../i18n/format-number';
import { parseCurrency } from '../i18n/parse-currency';
import { db } from '../db/db';
import { findMostRecentSale, recordMovement } from '../repos/movements';
import { lotsForVariant, remainingForLot } from '../repos/lots';
import { type Lot, type Movement, type MovementType, type UUID } from '../types';
import { formatQtyWithUom, inputQtyToInternal, type Uom } from '../config/article-traits';

export interface QuickAdjustTarget {
  variantId: UUID;
  // Size label for sized articles, null for sizeless ones (kiosk / grocery).
  // Sheet header uses an article-only title in the null case.
  size: string | null;
  articleName: string;
  currentQty: number;
  // Article catalogue sale_price_tnd (millimes). Used to preview the
  // sale / refund total when reason is sale or return; required so the
  // sheet doesn't have to fetch the article on its own.
  unitPriceTnd: number;
  // v0.5.2.9 (UoM): article's unit of measure drives whether the
  // qty input is a +/- stepper (piece) or a decimal text input
  // (kg / g / l / ml). Defaults to 'piece' for back-compat with
  // any caller that doesn't pass it.
  unitOfMeasure?: Uom;
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
  const currency = useCurrency();
  const [step, setStep] = useState(1);
  // v0.5.2.9 (UoM): when the article isn't piece, the merchant types
  // a decimal in display units (e.g. "0.850" for kg). On every
  // change we convert to internal smallest-unit (grams) and store
  // in `step` so the existing total preview + recordMovement code
  // path is unchanged. Empty string = qty 0 → submit disabled below.
  const [qtyInput, setQtyInput] = useState('1');
  const [reason, setReason] = useState<MovementType>(defaultReason);
  const [note, setNote] = useState('');
  // Optional per-sale price override. Empty string = use the article's
  // catalogue price. Validated on confirm via parseCurrency.
  const [discountInput, setDiscountInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // v0.5.1: when reason='return', we look up the most recent alive
  // sale of this variant. The sheet pre-fills the refund amount with
  // that sale's effective price (override ?? catalogue) and passes
  // its id as refunds_movement_id on confirm. Null means "no traceable
  // sale" — the merchant can still record a return; lot accounting
  // just skips the credit-back path.
  const [linkedSale, setLinkedSale] = useState<Movement | null>(null);
  // v0.5.2 ADR-020: alive lots with remaining > 0 for the variant.
  // When the merchant has ≥2 such lots and the reason is sale or
  // return, a Lot dropdown appears. Default selection is the FIFO
  // (earliest-expiry) lot — same as the /sell scan-driven path.
  const [aliveLots, setAliveLots] = useState<Array<{ lot: Lot; remaining: number }>>([]);
  const [selectedLotId, setSelectedLotId] = useState<UUID | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setQtyInput('1');
      setReason(defaultReason);
      setNote('');
      setDiscountInput('');
      setLinkedSale(null);
      setAliveLots([]);
      setSelectedLotId(null);
    }
  }, [open, defaultReason]);

  // Load alive lots when the sheet opens. We always load — the dropdown
  // visibility is decided at render time based on alive count + reason.
  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    void (async () => {
      const lots = await lotsForVariant(db, target.variantId);
      const withRemaining: Array<{ lot: Lot; remaining: number }> = [];
      for (const lot of lots) {
        const remaining = await remainingForLot(db, lot.id);
        if (remaining > 0) withRemaining.push({ lot, remaining });
      }
      if (cancelled) return;
      setAliveLots(withRemaining);
      // Default = FIFO (first in lotsForVariant's expires_at ascending).
      setSelectedLotId(withRemaining[0]?.lot.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  // Look up the most recent sale whenever the reason flips to return.
  // Cheap (single indexed query); intentionally not pre-fetched on
  // open so the sale lookup doesn't fire for the common sell / restock
  // paths.
  useEffect(() => {
    if (!open || reason !== 'return' || !target) {
      setLinkedSale(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const sale = await findMostRecentSale(db, target.variantId);
      if (cancelled) return;
      setLinkedSale(sale);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, reason, target]);

  if (!target) return null;

  // Override applies to sales + returns. Sales: "this customer paid X
  // instead of the catalogue price." Returns: "we refunded X instead
  // of the original sale price" (e.g. minus a restocking fee).
  const showPriceOverride = reason === 'sale' || reason === 'return';

  // Effective per-unit amount = override (if non-empty + parseable +
  // non-negative) ??  catalogue price. Live as the merchant types so
  // the preview line below stays accurate.
  function parsedOverride(): number | null {
    if (discountInput.trim() === '') return null;
    const parsed = parseCurrency(discountInput, locale, currency);
    if (parsed === null || parsed < 0) return null;
    return parsed;
  }
  // For returns with a linked sale, the default falls back to the
  // ORIGINAL sale's effective price — not the catalogue price, which
  // may have drifted between the sale and the return. Sales fall back
  // to the catalogue price. The merchant's explicit override always
  // wins.
  const refundFallback =
    reason === 'return' && linkedSale
      ? (linkedSale.unit_price_tnd ?? target?.unitPriceTnd ?? 0)
      : (target?.unitPriceTnd ?? 0);
  const effectiveUnit = target && showPriceOverride ? (parsedOverride() ?? refundFallback) : 0;
  const previewTotal = step * effectiveUnit;

  async function confirm(): Promise<void> {
    if (!target) return;
    setSubmitting(true);
    const sign = REASONS.find((r) => r.key === reason)?.sign ?? -1;
    // v0.5.1: ALWAYS snapshot the per-unit price on sales and returns
    // so the historical record is immune to catalogue drift. Without
    // this, a sale with no override stores unit_price_tnd=null;
    // dashboards then read the CURRENT catalogue at read time, and a
    // return looking up its linked sale finds null and falls back to
    // (possibly drifted) catalogue too. Snapshotting freezes the
    // amount at the moment of the transaction, which is what the
    // merchant intended.
    //
    // Override priority:
    //   1. Merchant typed an explicit override → use that.
    //   2. Return with a linked sale → reuse the linked sale's
    //      snapshotted unit_price_tnd (catalogue at sale time).
    //   3. Sale (no override) → snapshot the current catalogue.
    //   4. Return without a linked sale → snapshot current catalogue.
    let unitPriceOverride: number | null = null;
    if (showPriceOverride) {
      const typed = parsedOverride();
      if (typed !== null) {
        unitPriceOverride = typed;
      } else if (reason === 'return' && linkedSale) {
        unitPriceOverride = linkedSale.unit_price_tnd ?? target.unitPriceTnd;
      } else {
        unitPriceOverride = target.unitPriceTnd;
      }
    }
    // ADR-012: location is required for non-transfer movement types.
    // Quick Adjust doesn't expose a location picker (the v0.3 long-form
    // adjust does), so default to the most common case per reason:
    // purchases land on 'back' (stock arriving from supplier); sales,
    // returns, and adjustments happen on the 'floor' where the
    // merchant is standing.
    const defaultLocation = reason === 'purchase' ? 'back' : 'floor';
    // v0.5.2 ADR-020: lot_id on sale / return movements. Sales attribute
    // to the merchant-selected lot (default FIFO); returns credit back
    // to the lot the linked sale depleted (carried via refunds_
    // movement_id), falling back to the merchant's selection only when
    // there's no linked sale to inherit from.
    let lotIdForMovement: UUID | null = null;
    if (reason === 'sale' && selectedLotId) {
      lotIdForMovement = selectedLotId;
    } else if (reason === 'return' && linkedSale?.lot_id) {
      lotIdForMovement = linkedSale.lot_id;
    } else if (reason === 'return' && selectedLotId) {
      lotIdForMovement = selectedLotId;
    }
    await recordMovement(db, {
      variant_id: target.variantId,
      delta: sign * step,
      type: reason,
      note: note.trim() === '' ? null : note.trim(),
      unit_price_tnd: unitPriceOverride,
      location: defaultLocation,
      refunds_movement_id: reason === 'return' ? (linkedSale?.id ?? null) : null,
      lot_id: lotIdForMovement,
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
            {target.size
              ? t('title', { size: target.size, name: target.articleName })
              : target.articleName}
          </Dialog.Title>
          {(() => {
            const uom = target.unitOfMeasure ?? 'piece';
            const { value: currentVal, suffix: currentSuf } = formatQtyWithUom(
              target.currentQty,
              uom,
            );
            return (
              <p data-testid="adjust-current" className="text-ink-3 mt-1 font-mono text-xs">
                {currentSuf === ''
                  ? t('current', { n: formatNumber(currentVal, locale) })
                  : t('current_uom', {
                      n: formatNumber(currentVal, locale),
                      uom: currentSuf,
                    })}
              </p>
            );
          })()}

          {/* v0.5.2.9 (UoM): piece UoM keeps the +/- stepper (existing
              flow). Non-piece UoM (kg / g / l / ml) renders a decimal
              text input — `qtyInput` holds the merchant's typed display
              value, and on every change we convert via
              inputQtyToInternal to keep `step` in internal smallest
              units so the existing recordMovement + total-preview code
              never has to special-case UoM. */}
          {(target.unitOfMeasure ?? 'piece') === 'piece' ? (
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
          ) : (
            <div
              data-testid="adjust-qty-input"
              className="border-hair mt-4 flex items-center gap-2 rounded-xl border bg-white p-3"
            >
              <input
                data-testid="adjust-qty-input-field"
                type="text"
                inputMode="decimal"
                value={qtyInput}
                onChange={(e) => {
                  const text = e.target.value;
                  setQtyInput(text);
                  const parsed = Number(text.replace(',', '.'));
                  if (Number.isFinite(parsed) && parsed >= 0) {
                    const internal = inputQtyToInternal(parsed, target.unitOfMeasure ?? 'piece');
                    setStep(Math.max(0, internal));
                  } else {
                    setStep(0);
                  }
                }}
                className="flex-1 rounded-lg bg-paper px-3 py-2 text-end font-mono text-sm font-semibold tabular-nums"
                dir="ltr"
              />
              <span className="text-ink-3 text-xs">{target.unitOfMeasure}</span>
            </div>
          )}

          {/* v0.5.2 ADR-020: Lot picker. Only renders when this variant
              has ≥2 alive lots AND the reason is sale/return (the only
              reasons where lot_id is meaningful). Default selection is
              FIFO; merchant can override. */}
          {aliveLots.length >= 2 && (reason === 'sale' || reason === 'return') ? (
            <div className="mt-4">
              <label htmlFor="adjust-lot" className="text-ink-2 mb-1 block text-xs font-medium">
                {t('lot_picker_label')}
              </label>
              <select
                id="adjust-lot"
                data-testid="adjust-lot"
                value={selectedLotId ?? ''}
                onChange={(e) => setSelectedLotId(e.target.value === '' ? null : e.target.value)}
                className="border-hair w-full rounded-xl border bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {aliveLots.map(({ lot, remaining }, i) => (
                  <option key={lot.id} value={lot.id} data-testid={`adjust-lot-option-${lot.id}`}>
                    {t(i === 0 ? 'lot_option_fifo' : 'lot_option_alt', {
                      date: lot.expires_at.slice(0, 10),
                      remaining,
                    })}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

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

          {showPriceOverride ? (
            <div className="mt-4">
              <label
                htmlFor="adjust-discount"
                className="text-ink-2 mb-1 block text-xs font-medium"
              >
                {reason === 'return'
                  ? t('refund_label', { currency })
                  : t('discount_label', { currency })}
              </label>
              <input
                id="adjust-discount"
                data-testid="adjust-discount"
                type="text"
                inputMode="decimal"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder={t('discount_placeholder')}
                className="border-hair w-full rounded-xl border bg-white px-3 py-2 text-end font-mono text-sm"
              />
              <p className="text-ink-3 mt-1 text-[10.5px] leading-snug">
                {reason === 'return' ? t('refund_hint') : t('discount_hint')}
              </p>
              <p
                data-testid="adjust-preview-total"
                className={`mt-2 text-end font-mono text-[13px] font-semibold tabular-nums ${
                  reason === 'return' ? 'text-bad' : 'text-ink'
                }`}
                dir="ltr"
              >
                {reason === 'return' ? '−' : ''}
                {formatCurrency(previewTotal, locale, currency)}
              </p>
            </div>
          ) : null}

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
