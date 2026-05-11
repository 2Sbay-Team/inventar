import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Printer, Share2 } from 'lucide-react';

import { PhotoThumb } from '../components/photo-thumb';
import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { getInvoice } from '../repos/invoices';
import { invoicePdfFilename, renderInvoicePdf } from '../repos/invoice-pdf';
import { getPhoto, photoToBlob } from '../repos/photos';
import { formatQtyWithUom } from '../config/article-traits';
import { type Invoice, type ShopProfile } from '../types';

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
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

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

  // v0.5.2.5 — PDF export via Web Share API. The Share button always
  // generates a real PDF (`INV-YYYY-NNNN.pdf`); on phones with file-
  // sharing support (Chrome / Safari / most Android browsers) the OS
  // share sheet opens with WhatsApp / email / Drive as targets. On
  // desktop / older browsers we fall back to a download trigger.
  async function handleSharePdf(profile: ShopProfile, inv: Invoice): Promise<void> {
    setShareError(null);
    setSharing(true);
    try {
      // v0.5.2.7: pass the merchant's logo blob to the PDF renderer.
      // Looked up via getPhoto so the renderer stays Dexie-free (kept
      // testable without a DB). null when no logo is set.
      let logo: { blob: Blob; mime: string } | null = null;
      if (profile.logo_photo_id) {
        const photo = await getPhoto(db, profile.logo_photo_id);
        if (photo) {
          logo = { blob: photoToBlob(photo), mime: photo.mime };
        }
      }
      const bytes = await renderInvoicePdf({ invoice: inv, profile, locale, logo });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const file = new File([blob], invoicePdfFilename(inv), { type: 'application/pdf' });
      const nav = navigator as Navigator & { canShare?: (data?: ShareData) => boolean };
      if (typeof navigator.share === 'function' && nav.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: inv.number,
          text: `${inv.number} — ${profile.legal_name ?? profile.name ?? ''}`,
        });
        return;
      }
      // Fallback: trigger a download. The merchant can then attach
      // manually from the Files app.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = invoicePdfFilename(inv);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // AbortError comes from the user dismissing the share sheet —
      // not an error worth surfacing.
      const err = e as { name?: string; message?: string };
      if (err?.name !== 'AbortError') {
        setShareError(err?.message ?? String(e));
      }
    } finally {
      setSharing(false);
    }
  }

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
      <main data-testid="invoice-screen" className="flex flex-1 flex-col gap-4 p-4 print:p-0">
        <header className="flex items-start justify-between print:hidden">
          <div>
            <h2 className="font-display text-xl font-semibold">{t('title')}</h2>
            <p data-testid="invoice-number" className="text-ink-3 mt-1 font-mono text-xs" dir="ltr">
              {invoice.number}
            </p>
            <p className="text-ink-3 mt-0.5 text-xs">
              {new Date(invoice.issued_at).toLocaleString(locale)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="invoice-share"
                disabled={sharing || !profile}
                onClick={() => profile && void handleSharePdf(profile, invoice)}
                className="bg-accent inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                <Share2 aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
                {sharing ? t('sharing') : t('share_pdf')}
              </button>
              <button
                type="button"
                data-testid="invoice-print"
                onClick={() => window.print()}
                className="border-hair text-ink inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs"
              >
                <Printer aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
                {t('print')}
              </button>
              <button
                type="button"
                data-testid="invoice-back"
                onClick={() => navigate('/', { replace: true })}
                className="border-hair text-ink rounded-xl border px-3 py-1.5 text-xs"
              >
                {t('done')}
              </button>
            </div>
            {shareError ? (
              <p data-testid="invoice-share-error" className="text-bad text-xs">
                {t('share_error', { msg: shareError })}
              </p>
            ) : null}
          </div>
        </header>

        {/* Print-only header — duplicates the title + invoice number
            with the issued date, designed for the top of the printed
            page. The interactive header above is hidden via print:hidden. */}
        <div className="hidden print:mb-4 print:block">
          <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
          <p className="font-mono text-sm" dir="ltr">
            {invoice.number} · {new Date(invoice.issued_at).toLocaleDateString(locale)}
          </p>
        </div>

        <section className="border-hair grid grid-cols-2 gap-4 rounded-2xl border bg-white p-4 text-xs">
          <div>
            <h3 className="text-ink-3 mb-1 text-[10px] uppercase tracking-wide">{t('issuer')}</h3>
            {profile?.logo_photo_id ? (
              <div className="mb-2">
                <PhotoThumb
                  photoId={profile.logo_photo_id}
                  size={48}
                  testId="invoice-issuer-logo"
                />
              </div>
            ) : null}
            <p className="font-medium">{profile?.legal_name ?? profile?.name ?? ''}</p>
            {profile?.legal_address ? (
              <p className="text-ink-2 whitespace-pre-line">{profile.legal_address}</p>
            ) : null}
            {profile?.phone ? (
              <p data-testid="invoice-issuer-phone" className="text-ink-2 mt-1 font-mono" dir="ltr">
                {t('phone_label')}: {profile.phone}
              </p>
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
                    {(() => {
                      // v0.5.2.9 — show qty with the line's UoM suffix
                      // (e.g. "0.85 kg" / "500 g") so the printed
                      // invoice matches the merchant's product page.
                      const { value, suffix } = formatQtyWithUom(
                        line.qty,
                        line.unit_of_measure ?? 'piece',
                      );
                      return suffix === '' ? value : `${value} ${suffix}`;
                    })()}
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
          {(invoice.vat_enabled ?? true) ? (
            <div className="text-ink-3 mt-1 flex items-center justify-between text-xs">
              <span>
                {t('vat')} ({invoice.vat_pct}%)
              </span>
              <span data-testid="invoice-vat" className="font-mono tabular-nums" dir="ltr">
                {formatCurrency(invoice.vat_minor, locale, cur)}
              </span>
            </div>
          ) : null}
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
