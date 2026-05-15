import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { formatCurrency } from '../i18n/format-currency';
import { balanceDueForInvoice, listInvoices, paymentStatusForInvoice } from '../repos/invoices';
import { type Invoice } from '../types';

export function InvoicesListScreen(): JSX.Element {
  const { t } = useTranslation('invoice');
  const { locale } = useLocale();
  const invoices = useLive<Invoice[]>(() => listInvoices(db), [], []);

  return (
    <ScreenLayout hideNav>
      <main data-testid="invoices-list-screen" className="flex flex-1 flex-col gap-3 p-4">
        <h2 className="font-display text-xl font-semibold">{t('past_invoices_title')}</h2>
        {invoices.length === 0 ? (
          <p data-testid="invoices-list-empty" className="text-ink-3 mt-4 text-center text-sm">
            {t('past_invoices_empty')}
          </p>
        ) : (
          <ul data-testid="invoices-list-rows" className="space-y-2">
            {invoices.map((inv) => (
              <li key={inv.id}>
                {(() => {
                  const status = paymentStatusForInvoice(inv);
                  const balanceDue = balanceDueForInvoice(inv);
                  return (
                    <Link
                      to={`/invoice/${inv.id}`}
                      data-testid={`invoice-row-${inv.number}`}
                      className="border-hair flex items-center justify-between rounded-2xl border bg-white p-3"
                    >
                      <div className="flex flex-col">
                        <span className="font-mono text-sm" dir="ltr">
                          {inv.number}
                        </span>
                        <span className="text-ink-3 mt-0.5 text-xs">
                          {inv.customer_name ?? t('customer_walkin')} ·{' '}
                          {new Date(inv.issued_at).toLocaleDateString(locale)}
                        </span>
                        {balanceDue > 0 ? (
                          <span className="text-bad mt-1 text-xs font-semibold">
                            {t(`payment_status_${status}`)} ·{' '}
                            {formatCurrency(balanceDue, locale, inv.currency)} {t('balance_due')}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm tabular-nums" dir="ltr">
                          {formatCurrency(inv.total_minor, locale, inv.currency)}
                        </span>
                        <ChevronRight aria-hidden className="text-ink-3 h-4 w-4" strokeWidth={2} />
                      </div>
                    </Link>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
      </main>
    </ScreenLayout>
  );
}
