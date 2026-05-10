import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { getInvoice } from '../repos/invoices';
import { type Invoice } from '../types';

// v0.5.2.4 ADR-024 — minimal invoice view used as the post-issue
// landing page from /sell. This commit (Facture #2) renders the data
// in a plain, mobile-readable layout. Commit #3 wraps the same data
// in a print-optimised template (logo header, paginated lines,
// language-specific labels) and adds the Print button.
export function InvoiceViewScreen(): JSX.Element | null {
  const { t } = useTranslation('invoice');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { locale } = useLocale();
  const profile = useProfile();
  const [invoice, setInvoice] = useState<Invoice | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setInvoice(null);
      return;
    }
    void getInvoice(db, id).then((row) => {
      if (cancelled) return;
      setInvoice(row ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (invoice === undefined || profile === undefined) return null;
  if (!invoice) {
    return (
      <ScreenLayout hideNav>
        <div className="text-ink-3 p-6 text-center text-sm">{t('not_found')}</div>
      </ScreenLayout>
    );
  }

  const cur = invoice.currency;
  return (
    <ScreenLayout hideNav>
      <main data-testid="invoice-screen" className="flex flex-1 flex-col gap-4 p-4">
        <header className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('title')}</h2>
            <p data-testid="invoice-number" className="text-ink-3 mt-1 font-mono text-xs" dir="ltr">
              {invoice.number}
            </p>
            <p className="text-ink-3 mt-0.5 text-xs">
              {new Date(invoice.issued_at).toLocaleString(locale)}
            </p>
          </div>
          <button
            type="button"
            data-testid="invoice-back"
            onClick={() => navigate('/', { replace: true })}
            className="border-hair text-ink rounded-xl border px-3 py-1.5 text-xs"
          >
            {t('done')}
          </button>
        </header>

        <section className="border-hair grid grid-cols-2 gap-4 rounded-2xl border bg-white p-4 text-xs">
          <div>
            <h3 className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">{t('issuer')}</h3>
            <p className="font-medium">{profile?.legal_name ?? profile?.name ?? ''}</p>
            {profile?.legal_address ? (
              <p className="text-ink-2 whitespace-pre-line">{profile.legal_address}</p>
            ) : null}
            {profile?.fiscal_id ? (
              <p className="text-ink-3 mt-1 font-mono" dir="ltr">
                {t('fiscal_id_label')}: {profile.fiscal_id}
              </p>
            ) : null}
          </div>
          <div>
            <h3 className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">{t('customer')}</h3>
            <p className="font-medium">{invoice.customer_name ?? t('customer_walkin')}</p>
            {invoice.customer_address ? (
              <p className="text-ink-2 whitespace-pre-line">{invoice.customer_address}</p>
            ) : null}
            {invoice.customer_fiscal_id ? (
              <p className="text-ink-3 mt-1 font-mono" dir="ltr">
                {t('fiscal_id_label')}: {invoice.customer_fiscal_id}
              </p>
            ) : null}
          </div>
        </section>

        <section
          data-testid="invoice-lines"
          className="border-hair overflow-hidden rounded-2xl border bg-white"
        >
          <table className="w-full text-xs">
            <thead className="bg-paper-deep text-ink-3 uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('col_description')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('col_qty')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('col_unit_price')}</th>
                <th className="px-3 py-2 text-end font-medium">{t('col_line_total')}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i} className="border-hair border-t">
                  <td className="px-3 py-2">
                    <div className="text-ink font-medium">{line.description}</div>
                    {line.reference ? (
                      <div className="text-ink-3 font-mono text-[10px]" dir="ltr">
                        {line.reference}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {line.qty}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {formatCurrency(line.unit_price_minor, locale, cur)}
                  </td>
                  <td className="px-3 py-2 text-end font-mono tabular-nums" dir="ltr">
                    {formatCurrency(line.qty * line.unit_price_minor, locale, cur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="border-hair rounded-2xl border bg-white p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-ink-3">{t('subtotal')}</span>
            <span data-testid="invoice-subtotal" className="font-mono tabular-nums" dir="ltr">
              {formatCurrency(invoice.subtotal_minor, locale, cur)}
            </span>
          </div>
          <div className="text-ink-3 mt-1 flex items-center justify-between text-xs">
            <span>
              {t('vat')} ({invoice.vat_pct}%)
            </span>
            <span data-testid="invoice-vat" className="font-mono tabular-nums" dir="ltr">
              {formatCurrency(invoice.vat_minor, locale, cur)}
            </span>
          </div>
          <div className="border-hair mt-2 flex items-center justify-between border-t pt-2 text-base font-semibold">
            <span>{t('total')}</span>
            <span data-testid="invoice-total" className="font-mono tabular-nums" dir="ltr">
              {formatCurrency(invoice.total_minor, locale, cur)}
            </span>
          </div>
        </section>
      </main>
    </ScreenLayout>
  );
}
