import { formatCurrency } from '../i18n/format-currency';
import { type Customer, type Locale, type ShopProfile } from '../types';

interface PreviewSale {
  article_name: string;
  color: string | null;
  size: string | null;
  qty: number;
  unit_price_tnd?: number;
  discount_pct?: number | null;
  total: number;
}

interface InvoicePreviewPanelProps {
  sessionSales: PreviewSale[];
  documentMode: 'receipt' | 'invoice';
  paymentMode: 'paid' | 'partial' | 'unpaid';
  customer: Customer | null;
  partialPaidMinor: number | null;
  sessionRevenue: number;
  profile: ShopProfile | null;
  currency: string;
  locale: Locale;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export function InvoicePreviewPanel({
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
}: InvoicePreviewPanelProps): JSX.Element {
  const vatPct = profile?.default_vat_pct ?? 0;
  const vatEnabled = vatPct > 0 && documentMode === 'invoice';
  const vat = vatEnabled ? Math.round((sessionRevenue * vatPct) / 100) : 0;
  const total = sessionRevenue + vat;

  const paidAmount = paymentMode === 'paid' ? total : (partialPaidMinor ?? 0);
  const balanceDue = Math.max(0, total - paidAmount);

  const fmt = (n: number) => formatCurrency(n, locale, currency);

  if (sessionSales.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="border-hair flex h-16 w-16 items-center justify-center rounded-2xl border border-dashed">
          <svg
            aria-hidden
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-ink-4"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6M8 13h8M8 17h5" />
          </svg>
        </div>
        <p className="text-ink-3 text-sm">{t('preview_empty')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-0 text-[12px]">
      {/* Header badge */}
      <div className="border-hair border-b px-4 py-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
          {t('preview_title')}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {/* FROM */}
        <section>
          <p className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">From</p>
          <p className="font-semibold text-ink">{profile?.legal_name ?? profile?.name ?? '—'}</p>
          {profile?.legal_address ? (
            <p className="text-ink-2 whitespace-pre-line">{profile.legal_address}</p>
          ) : null}
          {profile?.fiscal_id ? (
            <p className="text-ink-3 font-mono" dir="ltr">
              {profile.fiscal_id}
            </p>
          ) : null}
        </section>

        {/* BILL TO */}
        <section>
          <p className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">
            {documentMode === 'invoice' ? 'Bill to' : 'Customer'}
          </p>
          <p className="font-semibold text-ink">{customer?.name ?? t('preview_walkin')}</p>
          {customer?.address ? <p className="text-ink-2">{customer.address}</p> : null}
        </section>

        {/* Line items */}
        <section>
          <div className="border-hair border-b pb-1 grid grid-cols-[1fr_auto_auto] gap-x-3 text-[10px] uppercase tracking-wide text-ink-3">
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Total</span>
          </div>
          <div className="divide-hair divide-y">
            {sessionSales.map((sale, i) => {
              const label = [sale.article_name, sale.color, sale.size]
                .filter((p): p is string => typeof p === 'string' && p.length > 0)
                .join(' · ');
              const unitPrice =
                sale.unit_price_tnd ?? Math.round(sale.total / Math.max(1, sale.qty));
              const hasDiscount = sale.discount_pct != null && sale.discount_pct > 0;
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_auto] gap-x-3 py-1.5 leading-snug">
                  <div>
                    <p className="text-ink font-medium">{label}</p>
                    <p className="text-ink-3 font-mono text-[10px]">
                      {hasDiscount ? (
                        <>
                          <span className="line-through opacity-60">{fmt(unitPrice)}</span>{' '}
                          <span className="text-emerald-700">-{sale.discount_pct}%</span>
                        </>
                      ) : (
                        `${fmt(unitPrice)} each`
                      )}
                    </p>
                  </div>
                  <span className="text-ink-2 self-start text-right tabular-nums">×{sale.qty}</span>
                  <span className="text-ink self-start text-right font-mono tabular-nums">
                    {fmt(sale.total)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Totals */}
        <section className="border-hair border-t pt-2 space-y-1">
          <div className="flex justify-between text-ink-2">
            <span>Subtotal</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {fmt(sessionRevenue)}
            </span>
          </div>
          {vatEnabled ? (
            <div className="flex justify-between text-ink-2">
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
        </section>

        {/* Payment status */}
        <section className="border-hair rounded-xl border bg-paper/60 p-3 space-y-1 text-ink-2">
          {paymentMode === 'paid' ? (
            <div className="flex justify-between">
              <span>Status</span>
              <span className="text-ok font-semibold">Paid in full</span>
            </div>
          ) : paymentMode === 'partial' ? (
            <>
              <div className="flex justify-between">
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
        </section>
      </div>
    </div>
  );
}
