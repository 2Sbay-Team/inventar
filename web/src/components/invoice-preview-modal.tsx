import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Settings, FileText } from 'lucide-react';
import { formatCurrency } from '../i18n/format-currency';
import { type Customer, type Locale, type ShopProfile } from '../types';

interface PreviewSale {
  article_name: string;
  color: string | null;
  size: string | null;
  qty: number;
  total: number;
}

interface InvoicePreviewModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onNavigateSettings: () => void;
  sessionSales: readonly PreviewSale[];
  documentMode: 'receipt' | 'invoice';
  paymentMode: 'paid' | 'partial' | 'unpaid';
  customer: Customer | null;
  partialPaidMinor: number | null;
  sessionRevenue: number;
  profile: ShopProfile | null | undefined;
  currency: string;
  locale: Locale;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function InvoicePreviewModal({
  open,
  onClose,
  onConfirm,
  onNavigateSettings,
  sessionSales,
  documentMode,
  paymentMode,
  customer,
  partialPaidMinor,
  sessionRevenue,
  profile,
  currency,
  locale,
  t,
}: InvoicePreviewModalProps): JSX.Element {
  const vatPct = profile?.default_vat_pct ?? 0;
  const vatEnabled = vatPct > 0 && documentMode === 'invoice';
  const vat = vatEnabled ? Math.round((sessionRevenue * vatPct) / 100) : 0;
  const total = sessionRevenue + vat;

  const paidAmount = paymentMode === 'paid' ? total : (partialPaidMinor ?? 0);
  const balanceDue = Math.max(0, total - paidAmount);

  const fmt = (n: number) => formatCurrency(n, locale, currency);

  // Compute compliance warnings
  const warnings: string[] = [];
  if (documentMode === 'invoice') {
    if (!profile?.legal_name) warnings.push('warn_no_legal_name');
    if (!profile?.legal_address) warnings.push('warn_no_address');
    if (!profile?.fiscal_id) warnings.push('warn_no_fiscal_id');
    if (!vatEnabled) warnings.push('warn_no_vat');
    if (!customer) warnings.push('warn_no_customer');
  }

  const canConfirm = !warnings.includes('warn_no_customer');

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content
          data-testid="invoice-preview-modal"
          className="fixed inset-x-4 top-[5%] z-50 mx-auto max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl max-h-[90dvh] flex flex-col"
        >
          <Dialog.Title className="sr-only">{t('preview_title')}</Dialog.Title>

          {/* Modal header */}
          <div className="border-hair flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <FileText aria-hidden className="text-accent h-4 w-4" strokeWidth={2} />
              <span className="font-display text-sm font-semibold text-ink">
                {t('preview_title')}
              </span>
            </div>
            <p className="text-ink-3 text-[11px] italic">{t('preview_disclaimer')}</p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Warnings */}
            {warnings.length > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle
                    aria-hidden
                    className="h-4 w-4 text-amber-600 flex-shrink-0"
                    strokeWidth={2}
                  />
                  <p className="text-sm font-semibold text-amber-800">
                    {t('preview_warnings_title')}
                  </p>
                </div>
                <ul className="space-y-1 pl-6">
                  {warnings.map((w) => (
                    <li key={w} className="text-sm text-amber-700 list-disc">
                      {t(w)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Invoice mock — FROM */}
            <div className="border-hair rounded-xl border bg-white p-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">From</p>
                  <p className="font-semibold text-ink">
                    {profile?.legal_name ?? profile?.name ?? '—'}
                  </p>
                  {profile?.legal_address ? (
                    <p className="text-ink-2 text-xs whitespace-pre-line mt-0.5">
                      {profile.legal_address}
                    </p>
                  ) : null}
                  {profile?.fiscal_id ? (
                    <p className="text-ink-3 text-xs font-mono mt-0.5" dir="ltr">
                      {profile.fiscal_id}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">
                    {documentMode === 'invoice' ? 'Bill to' : 'Customer'}
                  </p>
                  <p className="font-semibold text-ink">{customer?.name ?? t('preview_walkin')}</p>
                  {customer?.address ? (
                    <p className="text-ink-2 text-xs mt-0.5">{customer.address}</p>
                  ) : null}
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="border-hair border-b pb-1.5 grid grid-cols-[1fr_auto_auto] gap-x-4 text-[10px] uppercase tracking-wide text-ink-3">
                  <span>Description</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Total</span>
                </div>
                <div className="divide-hair divide-y">
                  {sessionSales.map((sale, i) => {
                    const label = [sale.article_name, sale.color, sale.size]
                      .filter((p): p is string => typeof p === 'string' && p.length > 0)
                      .join(' · ');
                    const unitPrice = Math.round(sale.total / Math.max(1, sale.qty));
                    return (
                      <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-4 py-2">
                        <div>
                          <p className="text-ink font-medium">{label}</p>
                          <p className="text-ink-3 font-mono text-[11px]">{fmt(unitPrice)} each</p>
                        </div>
                        <span className="text-ink-2 self-start text-right tabular-nums">
                          ×{sale.qty}
                        </span>
                        <span className="text-ink self-start text-right font-mono tabular-nums font-medium">
                          {fmt(sale.total)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Totals */}
              <div className="border-hair border-t pt-2 space-y-1">
                <div className="flex justify-between text-ink-2 text-sm">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {fmt(sessionRevenue)}
                  </span>
                </div>
                {vatEnabled ? (
                  <div className="flex justify-between text-ink-2 text-sm">
                    <span>VAT ({vatPct}%)</span>
                    <span className="font-mono tabular-nums" dir="ltr">
                      + {fmt(vat)}
                    </span>
                  </div>
                ) : null}
                <div className="flex justify-between font-semibold text-ink">
                  <span>Total</span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    {fmt(total)}
                  </span>
                </div>
              </div>

              {/* Payment status */}
              {paymentMode !== 'paid' ? (
                <div className="border-hair rounded-lg border p-2.5 space-y-1 text-sm">
                  {paymentMode === 'partial' ? (
                    <>
                      <div className="flex justify-between text-ink-2">
                        <span>Paid</span>
                        <span className="font-mono tabular-nums" dir="ltr">
                          {fmt(paidAmount > 0 ? paidAmount : 0)}
                        </span>
                      </div>
                      <div className="flex justify-between text-bad font-medium">
                        <span>Balance due</span>
                        <span className="font-mono tabular-nums" dir="ltr">
                          {fmt(balanceDue)}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between text-bad font-medium">
                      <span>Status</span>
                      <span>Unpaid — {fmt(total)} due</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-between text-ok font-semibold text-sm">
                  <span>Status</span>
                  <span>Paid in full</span>
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="border-hair border-t px-5 py-4 flex flex-col gap-2">
            <button
              type="button"
              data-testid="invoice-preview-confirm"
              onClick={onConfirm}
              disabled={!canConfirm}
              className="bg-ink inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              <FileText aria-hidden className="h-4 w-4" strokeWidth={2} />
              {t('preview_confirm')}
            </button>
            {warnings.length > 0 ? (
              <button
                type="button"
                data-testid="invoice-preview-fix-settings"
                onClick={onNavigateSettings}
                className="border-hair inline-flex w-full items-center justify-center gap-2 rounded-xl border bg-white py-3 text-sm font-medium text-ink"
              >
                <Settings aria-hidden className="h-4 w-4" strokeWidth={2} />
                {t('preview_fix_settings')}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="invoice-preview-close"
              onClick={onClose}
              className="text-ink-3 py-2 text-sm"
            >
              {t('cancel', { ns: 'common' })}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
