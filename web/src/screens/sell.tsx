import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Camera,
  CheckCircle2,
  Edit3,
  FileText,
  Minus,
  Plus,
  Search as SearchIcon,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from 'lucide-react';

import { BarcodeScanner } from '../components/barcode-scanner';
import { InvoicePreviewPanel } from '../components/invoice-preview-panel';
import { InvoicePreviewModal } from '../components/invoice-preview-modal';
import { PhotoThumb } from '../components/photo-thumb';
import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useBarcodeStream } from '../hooks/use-barcode-stream';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { formatCurrency } from '../i18n/format-currency';
import { parseCurrency } from '../i18n/parse-currency';
import { findArticleByEAN, findArticleByInternalCode } from '../repos/articles';
import { listCustomers } from '../repos/customers';
import { createInvoice, listInvoices } from '../repos/invoices';
import { pickFifoLot } from '../repos/lots';
import { recordMovement, revertMovement } from '../repos/movements';
import { quantityFor, sizeGridFor, type SizeGridCell } from '../repos/quantity';
import {
  type Article,
  type Customer,
  type InvoiceLine,
  type Locale,
  type ShopProfile,
  type UUID,
  type Variant,
} from '../types';
import { classifyScan } from '../utils/scan-classify';
import { getTaxRate } from '../utils/tax-rate';
import { newUUID } from '../utils/uuid';

// v0.9.x — Sale screen rewrite (replaces the v0.5 ADR-018 cart flow).
//
// Architecture shift: a SellScreen "session" is now a sequence of
// independent sales (one Movement committed per Confirm). The cart
// abstraction is gone — each Confirm decrements stock immediately and
// surfaces a toast, then the screen is ready for the next sale. The
// session is bounded by the merchant arriving at /sale and leaving via
// the ✕ (cancel) or [End →] action; all Movements created during the
// session share a `transaction_id` so /reports can show them as a
// session row.
//
// Top-level layout has two sub-tabs:
//   ?tab=sell        — the new sell flow (default)
//   ?tab=documents   — coming-soon placeholder for v0.8 quotes/invoices
//
// Per-vertical chrome:
//   profile.store_type === 'shop'   → camera viewfinder primary (top
//                                     of screen), search bar secondary
//   everything else (fashion, ...)  → search bar primary, [📷] icon
//                                     inside the search bar opens the
//                                     scanner as a modal
//
// Camera detection lives in useBarcodeStream / BarcodeScanner — those
// already fail-fast when there's no real camera (no touch + coarse
// pointer), so desktops never sit on a black <video>.

interface SessionSale {
  // Movement id, used as the React key in the summary list and for
  // future "undo last sale" wiring (out of scope for v0.9.x).
  movement_id: UUID;
  article_id: UUID;
  variant_id: UUID;
  article_name: string;
  internal_code: string;
  color: string | null;
  size: string | null;
  unit_of_measure: Article['unit_of_measure'];
  qty: number;
  unit_price_tnd: number; // unit price at confirmation time (may be overridden)
  discount_pct: number | null; // 0-100; null = no discount
  // qty × unit_price_tnd × (1 - discount_pct/100), in minor units
  total: number;
}

type SubTab = 'sell' | 'documents';
type SaleDocumentMode = 'receipt' | 'invoice';
type SalePaymentMode = 'paid' | 'partial' | 'unpaid';

function defaultInvoiceDueDateISO(now: Date = new Date()): string {
  const due = new Date(now);
  due.setDate(due.getDate() + 30);
  return due.toISOString();
}

function countCanCreateInvoice(
  count: number,
  partialPaymentInvalid: boolean,
  needsCustomer: boolean,
  isWalkIn: boolean,
): boolean {
  return count > 0 && !partialPaymentInvalid && !(needsCustomer && isWalkIn);
}

function parseTab(value: string | null): SubTab {
  return value === 'documents' ? 'documents' : 'sell';
}

export function SellScreen(): JSX.Element {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tab = parseTab(params.get('tab'));

  function selectTab(next: SubTab): void {
    navigate(next === 'sell' ? '/sale' : '/sale?tab=documents', { replace: true });
  }

  return (
    <ScreenLayout hideNav hideFooter wide>
      {tab === 'documents' ? (
        <DocumentsTab onSwitch={selectTab} active={tab} />
      ) : (
        <SellTab onSwitch={selectTab} active={tab} />
      )}
    </ScreenLayout>
  );
}

// ─── sub-tabs row ─────────────────────────────────────────────────────

function SubTabs(props: { active: SubTab; onSwitch: (t: SubTab) => void }): JSX.Element {
  const { active, onSwitch } = props;
  const { t } = useTranslation('sell');
  return (
    <nav
      data-testid="sale-subtabs"
      className="border-hair flex items-center gap-1 border-b bg-white px-3 py-2"
    >
      <button
        type="button"
        data-testid="sale-tab-sell"
        onClick={() => onSwitch('sell')}
        aria-pressed={active === 'sell'}
        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
          active === 'sell' ? 'bg-accent/10 text-accent' : 'text-ink-2'
        }`}
      >
        {t('subtab_sell')}
      </button>
      <button
        type="button"
        data-testid="sale-tab-documents"
        onClick={() => onSwitch('documents')}
        aria-pressed={active === 'documents'}
        className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
          active === 'documents' ? 'bg-accent/10 text-accent' : 'text-ink-2'
        }`}
      >
        {t('subtab_documents')}
      </button>
    </nav>
  );
}

// ─── Documents tab (placeholder) ──────────────────────────────────────

function DocumentsTab(props: { active: SubTab; onSwitch: (t: SubTab) => void }): JSX.Element {
  const { t } = useTranslation('sell');
  const navigate = useNavigate();
  const { locale } = useLocale();
  const currency = useCurrency();
  const invoices = useLive(() => listInvoices(db), [], []);

  return (
    <>
      <header className="border-hair grid grid-cols-3 items-center border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="sell-close"
          aria-label={t('close')}
          onClick={() => navigate('/reports', { replace: true })}
          className="text-ink-3 -ml-2 inline-flex h-9 w-9 items-center justify-center justify-self-start rounded-full"
        >
          <X aria-hidden className="h-6 w-6" strokeWidth={2.25} />
        </button>
        <h3 className="font-display inline-flex items-center justify-center gap-1.5 justify-self-center text-sm font-semibold tracking-tight">
          <FileText aria-hidden className="text-accent h-4 w-4" strokeWidth={2.25} />
          {t('documents_title')}
        </h3>
        <span />
      </header>
      <SubTabs active={props.active} onSwitch={props.onSwitch} />
      <main
        data-testid="documents-screen"
        className="flex flex-1 flex-col overflow-y-auto px-4 py-4"
      >
        <section className="rounded-2xl border border-accent/20 bg-accent-soft/30 p-4">
          <h2 className="font-display text-sm font-semibold text-ink">
            {t('documents_real_title')}
          </h2>
          <p className="text-ink-2 mt-1 text-xs leading-relaxed">{t('documents_real_body')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/sale"
              className="bg-accent inline-flex rounded-xl px-3 py-2 text-xs font-semibold text-white"
            >
              {t('documents_new_sale')}
            </Link>
            <Link
              to="/customers"
              className="border-hair inline-flex rounded-xl border bg-white px-3 py-2 text-xs font-semibold text-ink"
            >
              {t('documents_manage_customers')}
            </Link>
          </div>
        </section>

        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-ink">{t('documents_recent')}</h2>
            <Link to="/invoices" className="text-accent text-xs font-semibold">
              {t('documents_view_all')}
            </Link>
          </div>
          {invoices.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ink-4/70 bg-white p-6 text-center">
              <FileText aria-hidden className="text-ink-4 mx-auto h-10 w-10" strokeWidth={1.5} />
              <h3 className="font-display mt-3 text-sm font-semibold text-ink">
                {t('documents_empty_title')}
              </h3>
              <p className="text-ink-3 mt-1 text-xs leading-relaxed">{t('documents_empty_body')}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {invoices.slice(0, 10).map((invoice) => (
                <li key={invoice.id}>
                  <Link
                    to={`/invoice/${invoice.id}`}
                    className="border-hair flex items-center justify-between gap-3 rounded-2xl border bg-white p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-display truncate text-sm font-semibold text-ink">
                        {invoice.number}
                      </p>
                      <p className="text-ink-3 mt-0.5 truncate text-xs">
                        {invoice.customer_name || t('customer_walk_in')} ·{' '}
                        {new Date(invoice.issued_at).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="font-mono text-xs font-semibold text-ink" dir="ltr">
                      {formatCurrency(invoice.total_minor, locale, invoice.currency || currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

// ─── Sell tab (new flow) ──────────────────────────────────────────────

interface SellTabProps {
  active: SubTab;
  onSwitch: (t: SubTab) => void;
}

function SellTab({ active, onSwitch }: SellTabProps): JSX.Element {
  const { t } = useTranslation('sell');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();

  const customers = useLive(() => listCustomers(db), [], []);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('walk-in');
  const [documentMode, setDocumentMode] = useState<SaleDocumentMode>('receipt');
  const [paymentMode, setPaymentMode] = useState<SalePaymentMode>('paid');
  const [partialPaidText, setPartialPaidText] = useState('');

  const selectedCustomer = useMemo<Customer | null>(() => {
    if (selectedCustomerId === 'walk-in') return null;
    return customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  }, [customers, selectedCustomerId]);

  // Session state — committed per Confirm. Movements share this
  // transaction_id so reports can group them as one session row.
  const sessionIdRef = useRef<UUID>(newUUID());
  const [sessionSales, setSessionSales] = useState<SessionSale[]>([]);
  const [invoicing, setInvoicing] = useState(false);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [endConfirm, setEndConfirm] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pickerArticleId, setPickerArticleId] = useState<UUID | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cartHintShown, setCartHintShown] = useState(
    typeof window !== 'undefined' &&
      window.localStorage.getItem('inventar:hint_cart_edit_seen') !== 'true',
  );

  // Open picker immediately when navigated here from a QR scan redirect.
  useEffect(() => {
    const articleId = params.get('article');
    const openPicker = params.get('open_picker') === '1';
    if (articleId && openPicker) {
      setPickerArticleId(articleId as UUID);
    }
  }, [params]);
  const [toast, setToast] = useState<string | null>(null);

  // Auto-dismiss the success toast after 2 s. Cleared on unmount and on
  // a fresh toast firing so back-to-back sales don't hold onto a stale
  // timer.
  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 2000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  useEffect(() => {
    if (sessionSales.length > 0 && cartHintShown) {
      const timer = window.setTimeout(() => {
        setCartHintShown(false);
        window.localStorage.setItem('inventar:hint_cart_edit_seen', 'true');
      }, 8000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [sessionSales.length, cartHintShown]);

  // Live data — list of alive, non-archived articles + their variants.
  const articles = useLive<Article[]>(
    async () =>
      (await db.articles.toArray()).filter((a) => a.deleted_at === null && a.archived_at === null),
    [],
    [],
  );

  // Per-article (variants[], totalStock). Recomputed when sessionSales
  // grows so the running totals visible on each row reflect the latest
  // post-Confirm stock.
  const articleStock = useLive<Record<string, number>>(
    async () => {
      const variants = (await db.variants.toArray()).filter((v) => v.deleted_at === null);
      const byVariant = new Map<string, Variant[]>();
      for (const v of variants) {
        const arr = byVariant.get(v.article_id);
        if (arr) arr.push(v);
        else byVariant.set(v.article_id, [v]);
      }
      const out: Record<string, number> = {};
      for (const [aid, vs] of byVariant.entries()) {
        let total = 0;
        for (const v of vs) {
          total += await quantityFor(db, v.id);
        }
        out[aid] = total;
      }
      return out;
    },
    [sessionSales.length],
    {},
  );

  // Category chips — `All` plus the merchant's active subtypes. Localised
  // labels live under sell.category_*; we fall back to the raw key if a
  // label hasn't been added yet, which avoids a noisy `[missing]` chip
  // while we're rolling out subtypes.
  const categories = useMemo<readonly string[]>(() => {
    if (!profile) return [];
    const list =
      profile.store_type === 'shop'
        ? profile.shop_subtypes
        : profile.store_type === 'fashion'
          ? profile.fashion_subtypes
          : [];
    return ['all', ...list];
  }, [profile]);

  // Filter + sort the article list. 0-stock rows still show; they're
  // pushed to the bottom and rendered greyed-out so the merchant knows
  // the SKU exists but is exhausted.
  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (articles ?? [])
      .filter((a) => {
        if (category !== 'all' && a.category !== category) return false;
        if (q.length === 0) return true;
        return (
          a.name.toLowerCase().includes(q) ||
          a.internal_code.toLowerCase().includes(q) ||
          (a.barcode_ean ?? '').includes(q)
        );
      })
      .sort((a, b) => {
        const sa = articleStock[a.id] ?? 0;
        const sb = articleStock[b.id] ?? 0;
        if (sa === 0 && sb !== 0) return 1;
        if (sa !== 0 && sb === 0) return -1;
        if (sa !== sb) return sb - sa;
        return a.name.localeCompare(b.name);
      });
  }, [articles, articleStock, category, search]);

  // Quick-sell strip — top 3 articles by sales count over the lifetime
  // of the catalogue. Computed once at mount via a Movement scan; the
  // session itself is short-lived so re-fetching on each Confirm would
  // be wasteful and visually jumpy.
  const topSold = useLive<Article[]>(
    async () => {
      const sales = (await db.movements.toArray()).filter(
        (m) => m.type === 'sale' && m.deleted_at === null,
      );
      const variants = await db.variants.toArray();
      const variantToArticle = new Map<string, string>();
      for (const v of variants) variantToArticle.set(v.id, v.article_id);
      const tally = new Map<string, number>();
      for (const s of sales) {
        const aid = variantToArticle.get(s.variant_id);
        if (!aid) continue;
        tally.set(aid, (tally.get(aid) ?? 0) - s.delta);
      }
      const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const out: Article[] = [];
      for (const [aid] of ranked) {
        const a = await db.articles.get(aid);
        if (a && a.deleted_at === null && a.archived_at === null) out.push(a);
      }
      return out;
    },
    [],
    [],
  );

  // Exact-code-match: typing the internal code (or a scannable EAN) of
  // an article jumps directly to the variant picker for that article.
  // Doesn't trigger if the typed value also matches the start of more
  // than one product's code prefix (we want a deterministic exact-hit).
  useEffect(() => {
    const q = search.trim();
    if (q.length < 3) return;
    const exact = (articles ?? []).find(
      (a) => a.internal_code.toLowerCase() === q.toLowerCase() || a.barcode_ean === q,
    );
    if (exact) {
      setPickerArticleId(exact.id);
      setSearch('');
    }
  }, [search, articles]);

  // ─── confirm-sale glue ─────────────────────────────────────────────
  async function confirmSale(input: {
    article: Article;
    variant: Variant;
    qty: number;
    unitPriceOverride: number | null;
  }): Promise<void> {
    const { article, variant, qty, unitPriceOverride } = input;
    if (qty <= 0) return;
    const effectivePrice = unitPriceOverride ?? article.sale_price_tnd;
    try {
      const lot = await pickFifoLot(db, variant.id);
      const mv = await recordMovement(db, {
        variant_id: variant.id,
        delta: -qty,
        type: 'sale',
        location: 'floor',
        transaction_id: sessionIdRef.current,
        lot_id: lot?.id ?? null,
        unit_price_tnd: effectivePrice,
      });
      const sale: SessionSale = {
        movement_id: mv.id,
        article_id: article.id,
        variant_id: variant.id,
        article_name: article.name,
        internal_code: article.internal_code,
        color: variant.color,
        size: variant.size,
        unit_of_measure: article.unit_of_measure,
        qty,
        unit_price_tnd: effectivePrice,
        discount_pct: null,
        total: qty * effectivePrice,
      };
      setSessionSales((s) => [...s, sale]);
      setPickerArticleId(null);
      const label = [article.name, variant.color, variant.size]
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
        .join(' ');
      setToast(t('toast_sold', { label, total: formatCurrency(sale.total, locale, currency) }));
    } catch (err) {
      console.error('confirmSale failed', err);
      setToast(t('sale_record_failed'));
    }
  }

  async function removeSaleFromCart(movementId: UUID): Promise<void> {
    try {
      await revertMovement(db, movementId);
      setSessionSales((s) => s.filter((sale) => sale.movement_id !== movementId));
      setToast(t('toast_removed'));
    } catch (err) {
      console.error('removeSaleFromCart failed', err);
      setToast(t('cart_remove_failed'));
    }
  }

  async function updateCartQuantity(sale: SessionSale, newQty: number): Promise<void> {
    if (newQty <= 0) {
      await removeSaleFromCart(sale.movement_id);
      return;
    }
    try {
      await revertMovement(db, sale.movement_id);
      const unitPrice = sale.unit_price_tnd;
      const discountedPrice = unitPrice * (1 - (sale.discount_pct ?? 0) / 100);
      const lot = await pickFifoLot(db, sale.variant_id);
      const mv = await recordMovement(db, {
        variant_id: sale.variant_id,
        delta: -newQty,
        type: 'sale',
        location: 'floor',
        transaction_id: sessionIdRef.current,
        lot_id: lot?.id ?? null,
        unit_price_tnd: discountedPrice,
      });
      const updated: SessionSale = {
        ...sale,
        movement_id: mv.id,
        qty: newQty,
        total: discountedPrice * newQty,
      };
      setSessionSales((s) => s.map((x) => (x.movement_id === sale.movement_id ? updated : x)));
      setToast(t('toast_qty_updated'));
    } catch (err) {
      console.error('updateCartQuantity failed', err);
      setToast(t('cart_qty_failed'));
    }
  }

  async function updateCartDiscount(
    sale: SessionSale,
    newDiscountPct: number | null,
  ): Promise<void> {
    if (newDiscountPct !== null && (newDiscountPct < 0 || newDiscountPct > 100)) {
      setToast(t('discount_invalid'));
      return;
    }
    const discountedUnitPrice = sale.unit_price_tnd * (1 - (newDiscountPct ?? 0) / 100);
    const newTotal = sale.qty * discountedUnitPrice;
    try {
      await revertMovement(db, sale.movement_id);
      const lot = await pickFifoLot(db, sale.variant_id);
      const mv = await recordMovement(db, {
        variant_id: sale.variant_id,
        delta: -sale.qty,
        type: 'sale',
        location: 'floor',
        transaction_id: sessionIdRef.current,
        lot_id: lot?.id ?? null,
        unit_price_tnd: discountedUnitPrice,
      });
      const updated: SessionSale = {
        ...sale,
        movement_id: mv.id,
        discount_pct: newDiscountPct,
        total: newTotal,
      };
      setSessionSales((s) => s.map((x) => (x.movement_id === sale.movement_id ? updated : x)));
    } catch (err) {
      console.error('updateCartDiscount failed', err);
      setToast(t('discount_update_failed'));
    }
  }

  async function createSessionInvoice(): Promise<void> {
    if (sessionSales.length === 0) return;
    if (invoicing) return;
    setInvoicing(true);
    try {
      const paidMinor =
        paymentMode === 'partial' ? parseCurrency(partialPaidText, locale, currency) : null;
      if (
        paymentMode === 'partial' &&
        (paidMinor === null || paidMinor <= 0 || paidMinor >= sessionRevenue)
      ) {
        setToast(t('partial_paid_invalid'));
        return;
      }
      const effectiveVatPct = sessionSales.reduce((max, sale) => {
        const article = (articles ?? []).find((a) => a.id === sale.article_id);
        if (!article) return max;
        const rate = getTaxRate(article, profile ?? null) ?? 0;
        return Math.max(max, rate);
      }, 0);
      const lines: InvoiceLine[] = sessionSales.map((sale) => ({
        description: [sale.article_name, sale.color, sale.size]
          .filter((part): part is string => typeof part === 'string' && part.length > 0)
          .join(' · '),
        reference: sale.internal_code,
        qty: sale.qty,
        unit_price_minor: Math.round(sale.total / Math.max(1, sale.qty)),
        unit_of_measure: sale.unit_of_measure,
      }));
      const customerAddress = selectedCustomer
        ? [selectedCustomer.address, selectedCustomer.city, selectedCustomer.country]
            .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
            .join(', ') || null
        : null;
      const invoice = await createInvoice(db, {
        transaction_id: sessionIdRef.current,
        customer_id: selectedCustomer?.id ?? null,
        customer_name: selectedCustomer?.name ?? null,
        customer_address: customerAddress,
        customer_fiscal_id: selectedCustomer?.fiscal_id ?? null,
        lines,
        currency,
        vat_pct: effectiveVatPct,
        vat_enabled: effectiveVatPct > 0,
        payment_mode: paymentMode,
        paid_minor: paymentMode === 'partial' ? (paidMinor ?? 0) : undefined,
        due_at: paymentMode === 'paid' ? null : defaultInvoiceDueDateISO(),
        notes: null,
      });
      navigate(`/invoice/${invoice.id}`);
    } catch (err) {
      console.error('createSessionInvoice failed', err);
      setToast(t('invoice_create_failed'));
    } finally {
      setInvoicing(false);
    }
  }

  // ─── camera handler ────────────────────────────────────────────────
  async function onScanDetected(rawValue: string): Promise<void> {
    setScannerOpen(false);
    const cls = classifyScan(rawValue);
    if (!cls) {
      setScanError(t('scan_invalid'));
      return;
    }
    let article: Article | undefined;
    if (cls.kind === 'article_url') {
      const row = await db.articles.get(cls.articleId);
      article = row && row.deleted_at === null ? row : undefined;
    } else if (cls.kind === 'ean') {
      article = await findArticleByEAN(db, cls.value);
    } else {
      article = await findArticleByInternalCode(db, cls.value);
    }
    if (!article) {
      setScanError(t('scan_unknown'));
      return;
    }
    setPickerArticleId(article.id);
    setScanError(null);
  }

  // TODO(router-upgrade): useBlocker for bottom-nav cart protection.
  // useBlocker()/usePrompt() require the data router (createBrowserRouter /
  // RouterProvider). This app uses BrowserRouter, so the hook throws at
  // runtime. Until the router is migrated, bottom-nav taps with a non-empty
  // cart navigate away without confirmation. The X-button and "End →" chip
  // already trigger EndSessionDialog, so only the nav-bar path is unguarded.
  // Migration path: replace <BrowserRouter> in app.tsx with createBrowserRouter,
  // then add useBlocker here matching the shouldBlock logic above.

  // ─── X / End session ───────────────────────────────────────────────
  function handleClose(): void {
    if (sessionSales.length === 0) {
      navigate('/reports', { replace: true });
      return;
    }
    setEndConfirm(true);
  }

  const sessionCount = sessionSales.length;
  const sessionRevenue = sessionSales.reduce((s, x) => s + x.total, 0);
  const hasBillableTotal = sessionRevenue > 0;
  const partialPaidMinor =
    paymentMode === 'partial' ? parseCurrency(partialPaidText, locale, currency) : null;
  const partialPaymentInvalid =
    paymentMode === 'partial' &&
    sessionRevenue > 0 &&
    (partialPaidMinor === null || partialPaidMinor <= 0 || partialPaidMinor >= sessionRevenue);
  const cameraFirst = profile?.store_type === 'shop';
  const vatNotConfigured =
    profile !== undefined && profile?.default_vat_pct == null && sessionSales.length > 0;

  useEffect(() => {
    if (!hasBillableTotal && paymentMode !== 'paid') {
      setPaymentMode('paid');
    }
  }, [hasBillableTotal, paymentMode]);

  // ─── render ────────────────────────────────────────────────────────
  return (
    <>
      <header className="border-hair grid grid-cols-3 items-center border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="sell-close"
          aria-label={tCommon('close')}
          onClick={handleClose}
          className="text-ink-3 -ml-2 inline-flex h-9 w-9 items-center justify-center justify-self-start rounded-full"
        >
          <X aria-hidden className="h-6 w-6" strokeWidth={2.25} />
        </button>
        <h3 className="font-display inline-flex items-center justify-center gap-1.5 justify-self-center text-sm font-semibold tracking-tight">
          <ShoppingCart aria-hidden className="text-accent h-4 w-4" strokeWidth={2.25} />
          {t('title')}
        </h3>
        {sessionCount > 0 ? (
          <div className="relative justify-self-end">
            <button
              type="button"
              data-testid="sell-end-session"
              onClick={() => setSummaryOpen(true)}
              aria-label={t('open_cart_aria')}
              className="bg-accent inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-white"
              dir="ltr"
            >
              <Edit3 aria-hidden className="h-3 w-3 opacity-80" strokeWidth={2} />
              {t('end_session_chip', {
                n: sessionCount,
                total: formatCurrency(sessionRevenue, locale, currency),
              })}
              <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={2.5} />
            </button>
            {cartHintShown && sessionSales.length > 0 ? (
              <div
                data-testid="cart-edit-hint"
                className="bg-ink absolute right-0 top-8 z-30 w-56 rounded-lg p-3 text-xs text-white shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => {
                    setCartHintShown(false);
                    window.localStorage.setItem('inventar:hint_cart_edit_seen', 'true');
                  }}
                  className="float-end -me-1 -mt-1 text-white/80 hover:text-white"
                  aria-label={tCommon('close')}
                >
                  ×
                </button>
                <p className="pe-4">{t('hint_cart_edit')}</p>
                <div className="bg-ink absolute -top-1 right-4 h-2 w-2 rotate-45" />
              </div>
            ) : null}
          </div>
        ) : (
          <span
            data-testid="sell-empty-counter"
            className="text-ink-3 justify-self-end font-mono text-[11px]"
            dir="ltr"
          >
            {t('empty_counter', { total: formatCurrency(0, locale, currency) })}
          </span>
        )}
      </header>

      <SubTabs active={active} onSwitch={onSwitch} />

      <div className="flex min-h-0 flex-1">
        <main data-testid="sell-screen" className="flex flex-1 flex-col overflow-y-auto">
          {cameraFirst ? <ShopCameraStrip onDetected={onScanDetected} /> : null}

          <SaleCustomerPanel
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            onSelectCustomer={setSelectedCustomerId}
            documentMode={documentMode}
            onDocumentMode={setDocumentMode}
            paymentMode={paymentMode}
            onPaymentMode={setPaymentMode}
            partialPaidText={partialPaidText}
            onPartialPaidText={setPartialPaidText}
            partialTotalLabel={formatCurrency(sessionRevenue, locale, currency)}
            hasBillableTotal={hasBillableTotal}
            t={t}
          />

          {documentMode === 'invoice' && vatNotConfigured ? (
            <div
              data-testid="vat-setup-banner"
              className="mx-4 my-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle
                  aria-hidden
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-900">
                    {t('vat_not_configured_title')}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">{t('vat_not_configured_body')}</p>
                  <button
                    type="button"
                    data-testid="vat-setup-cta"
                    onClick={() => navigate('/settings')}
                    className="mt-2 inline-flex rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
                  >
                    {t('vat_not_configured_cta')}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <SearchScanBar
            value={search}
            onChange={setSearch}
            onOpenCamera={() => setScannerOpen(true)}
            showCameraIcon={!cameraFirst}
            t={t}
          />

          {categories.length > 1 ? (
            <CategoryChips categories={categories} active={category} onSelect={setCategory} t={t} />
          ) : null}

          {scanError ? (
            <p
              data-testid="sell-scan-error"
              role="alert"
              className="text-bad bg-bad/10 border-bad/30 mx-4 mt-2 rounded-xl border px-3 py-2 text-center text-xs"
            >
              {scanError}
            </p>
          ) : null}

          {topSold.length > 0 ? (
            <QuickSellStrip
              articles={topSold}
              stock={articleStock}
              onPick={(a) => setPickerArticleId(a.id)}
              t={t}
            />
          ) : null}

          <section className="mt-3 px-4 pb-4">
            <p className="text-ink-3 mb-2 text-[11px] font-medium uppercase tracking-wide">
              {t('all_products_heading')}
            </p>
            {filteredArticles.length === 0 ? (
              <p data-testid="sell-list-empty" className="text-ink-3 mt-6 text-center text-xs">
                {search.trim() === ''
                  ? t('list_no_products')
                  : t('list_no_match', { query: search.trim() })}
              </p>
            ) : (
              <ul data-testid="sell-products-list" className="space-y-1.5">
                {filteredArticles.map((a) => (
                  <ProductRow
                    key={a.id}
                    article={a}
                    stock={articleStock[a.id] ?? 0}
                    currency={currency}
                    locale={locale}
                    onTap={() => setPickerArticleId(a.id)}
                  />
                ))}
              </ul>
            )}
          </section>
        </main>

        <aside
          data-testid="invoice-preview-panel"
          className="border-hair hidden lg:flex lg:w-[380px] lg:flex-shrink-0 lg:flex-col border-l bg-white"
        >
          <InvoicePreviewPanel
            sessionSales={sessionSales}
            documentMode={documentMode}
            paymentMode={paymentMode}
            customer={selectedCustomer}
            partialPaidMinor={partialPaidMinor}
            sessionRevenue={sessionRevenue}
            profile={profile ?? null}
            currency={currency}
            locale={locale}
            t={t}
          />
        </aside>
      </div>

      {toast ? (
        <output
          data-testid="sell-toast"
          aria-live="polite"
          className="bg-good fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl px-4 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </output>
      ) : null}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(v) => void onScanDetected(v)}
        keepOpenAfterDetect={false}
      />

      {pickerArticleId ? (
        <VariantPicker
          articleId={pickerArticleId}
          locale={locale}
          currency={currency}
          onClose={() => setPickerArticleId(null)}
          onConfirm={(input) => void confirmSale(input)}
          t={t}
          tCommon={tCommon}
        />
      ) : null}

      {endConfirm ? (
        <EndSessionDialog
          open={true}
          count={sessionCount}
          total={sessionRevenue}
          locale={locale}
          currency={currency}
          onKeep={() => setEndConfirm(false)}
          onEnd={() => {
            setEndConfirm(false);
            navigate('/reports', { replace: true });
          }}
          t={t}
        />
      ) : null}

      {summaryOpen ? (
        <SessionSummary
          open={true}
          count={sessionCount}
          total={sessionRevenue}
          locale={locale}
          currency={currency}
          onBack={() => navigate('/products', { replace: true })}
          onReports={() => navigate('/reports', { replace: true })}
          onResume={() => setSummaryOpen(false)}
          onCreateInvoice={() => void createSessionInvoice()}
          canCreateInvoice={countCanCreateInvoice(
            sessionCount,
            partialPaymentInvalid,
            documentMode === 'invoice' || paymentMode !== 'paid',
            selectedCustomerId === 'walk-in',
          )}
          invoiceInFlight={invoicing}
          paymentWarning={partialPaymentInvalid ? t('partial_paid_invalid') : null}
          documentMode={documentMode}
          onDocumentMode={setDocumentMode}
          paymentMode={paymentMode}
          onPaymentMode={setPaymentMode}
          partialPaidText={partialPaidText}
          onPartialPaidText={setPartialPaidText}
          partialTotalLabel={formatCurrency(sessionRevenue, locale, currency)}
          customer={selectedCustomer}
          sessionSales={sessionSales}
          sales={sessionSales}
          onRemoveSale={(id) => void removeSaleFromCart(id)}
          onUpdateQty={(sale, qty) => void updateCartQuantity(sale, qty)}
          onUpdateDiscount={(sale, pct) => void updateCartDiscount(sale, pct)}
          profile={profile}
          partialPaidMinor={partialPaidMinor}
          onNavigateSettings={() => {
            setSummaryOpen(false);
            navigate('/settings');
          }}
          t={t}
        />
      ) : null}
    </>
  );
}

function SaleCustomerPanel(props: {
  customers: readonly Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (id: string) => void;
  documentMode: SaleDocumentMode;
  onDocumentMode: (mode: SaleDocumentMode) => void;
  paymentMode: SalePaymentMode;
  onPaymentMode: (mode: SalePaymentMode) => void;
  partialPaidText: string;
  onPartialPaidText: (value: string) => void;
  partialTotalLabel: string;
  hasBillableTotal: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const {
    customers,
    selectedCustomerId,
    onSelectCustomer,
    documentMode,
    onDocumentMode,
    paymentMode,
    onPaymentMode,
    partialPaidText,
    onPartialPaidText,
    partialTotalLabel,
    hasBillableTotal,
    t,
  } = props;
  const needsCustomer = documentMode === 'invoice' || paymentMode !== 'paid';
  return (
    <section
      data-testid="sale-customer-panel"
      className="mx-4 mt-3 rounded-2xl border border-hair bg-white p-3"
    >
      <div className="flex items-start gap-3">
        <Users
          aria-hidden
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent"
          strokeWidth={2.25}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold text-ink">
                {t('customer_section_title')}
              </h2>
              <Link to="/customers" className="text-accent text-xs font-semibold">
                {t('customer_manage')}
              </Link>
            </div>
            <p className="text-ink-3 mt-1 text-xs leading-relaxed">{t('customer_section_hint')}</p>
          </div>

          <select
            data-testid="sale-customer-select"
            value={selectedCustomerId}
            onChange={(event) => onSelectCustomer(event.target.value)}
            className="border-hair text-ink w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          >
            <option value="walk-in">{t('customer_walk_in')}</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-2">
            {(['receipt', 'invoice'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`sale-document-${mode}`}
                onClick={() => onDocumentMode(mode)}
                aria-pressed={documentMode === mode}
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                  documentMode === mode
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-hair bg-white text-ink-2'
                }`}
              >
                {t(`document_${mode}`)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(['paid', 'partial', 'unpaid'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`sale-payment-${mode}`}
                onClick={() => onPaymentMode(mode)}
                aria-pressed={paymentMode === mode}
                className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                  paymentMode === mode
                    ? 'border-accent bg-accent text-white'
                    : 'border-hair bg-white text-ink-2'
                }`}
              >
                {t(`payment_${mode}`)}
              </button>
            ))}
          </div>

          {(paymentMode === 'partial' || paymentMode === 'unpaid') && !hasBillableTotal ? (
            <p
              data-testid="payment-mode-empty-hint"
              className="text-ink-3 mt-2 text-[11px] leading-relaxed"
            >
              {t(paymentMode === 'partial' ? 'partial_empty_cart_hint' : 'unpaid_empty_cart_hint')}
            </p>
          ) : null}

          {paymentMode === 'partial' && hasBillableTotal ? (
            <div>
              <label className="text-ink-3 mb-1 block text-[11px] font-medium uppercase tracking-wide">
                {t('partial_paid_label')}
              </label>
              <input
                data-testid="sale-partial-paid"
                type="text"
                inputMode="decimal"
                value={partialPaidText}
                onChange={(event) => onPartialPaidText(event.target.value)}
                placeholder={t('partial_paid_placeholder')}
                className="border-hair text-ink w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm"
              />
              <p className="text-ink-3 mt-1 text-xs">
                {t('partial_paid_hint', { total: partialTotalLabel })}
              </p>
            </div>
          ) : null}

          {needsCustomer && selectedCustomerId === 'walk-in' && hasBillableTotal ? (
            <p className="rounded-xl border border-bad/20 bg-bad/10 px-3 py-2 text-xs text-bad">
              {t('customer_required_hint')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─── shop-vertical camera strip ───────────────────────────────────────

function ShopCameraStrip(props: { onDetected: (v: string) => void }): JSX.Element | null {
  const { onDetected } = props;
  // Always-on viewfinder at the top of the screen for the shop vertical.
  // useBarcodeStream is the existing inline-scanner hook; it self-gates
  // on touch + coarse pointer, so desktops drop straight through to
  // `supported=false` and we render nothing (spec: "Camera failure →
  // hide viewfinder silently"). The screen's search bar remains the
  // user's escape hatch.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const { videoRef, supported, error } = useBarcodeStream({
    onDetect: (v) => onDetectedRef.current(v),
  });
  if (!supported || error) return null;
  return (
    <div
      data-testid="sell-camera-strip"
      className="relative mx-3 mt-3 aspect-[5/3] overflow-hidden rounded-2xl bg-black"
    >
      <video
        ref={videoRef}
        data-testid="sell-camera-video"
        playsInline
        muted
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="border-accent/80 h-28 w-40 rounded-xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
      </div>
    </div>
  );
}

// ─── search + scan input bar ──────────────────────────────────────────

function SearchScanBar(props: {
  value: string;
  onChange: (v: string) => void;
  onOpenCamera: () => void;
  showCameraIcon: boolean;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { value, onChange, onOpenCamera, showCameraIcon, t } = props;
  return (
    <div className="px-4 pt-3">
      <div className="border-hair flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 shadow-sm">
        <SearchIcon aria-hidden className="text-ink-3 h-4 w-4" strokeWidth={2} />
        <input
          data-testid="sell-search-input"
          type="text"
          inputMode="search"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('search_placeholder_v2')}
          className="text-ink flex-1 bg-transparent text-sm outline-none placeholder:text-ink-4"
        />
        {showCameraIcon ? (
          <button
            type="button"
            data-testid="sell-scan-trigger"
            aria-label={t('open_scanner')}
            onClick={onOpenCamera}
            className="text-ink-3 -mr-1 inline-flex h-8 w-8 items-center justify-center rounded-lg"
          >
            <Camera aria-hidden className="h-5 w-5" strokeWidth={2.25} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── category chips ───────────────────────────────────────────────────

function CategoryChips(props: {
  categories: readonly string[];
  active: string;
  onSelect: (c: string) => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { categories, active, onSelect, t } = props;
  return (
    <div data-testid="sell-category-chips" className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-4">
      {categories.map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`sell-chip-${c}`}
          onClick={() => onSelect(c)}
          aria-pressed={active === c}
          className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            active === c ? 'bg-accent text-white' : 'border-hair text-ink-2 border bg-white'
          }`}
        >
          {c === 'all' ? t('category_all') : t(`category_${c}`, { defaultValue: c })}
        </button>
      ))}
    </div>
  );
}

// ─── quick sell strip ─────────────────────────────────────────────────

function QuickSellStrip(props: {
  articles: readonly Article[];
  stock: Record<string, number>;
  onPick: (a: Article) => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { articles, stock, onPick, t } = props;
  return (
    <section className="mt-4 px-4">
      <p className="text-ink-3 mb-2 text-[11px] font-medium uppercase tracking-wide">
        {t('quick_sell_heading')}
      </p>
      <div data-testid="sell-quick-strip" className="-mx-1 flex gap-2 overflow-x-auto pb-1">
        {articles.map((a) => (
          <button
            key={a.id}
            type="button"
            data-testid={`sell-quick-${a.internal_code}`}
            onClick={() => onPick(a)}
            className="border-hair flex w-[120px] flex-shrink-0 flex-col items-center gap-1 rounded-2xl border bg-white p-2"
          >
            <PhotoThumb photoId={a.photo_id} size={88} />
            <span className="text-ink line-clamp-1 w-full text-center text-xs font-medium">
              {a.name}
            </span>
            <span className="text-ink-3 font-mono text-[10px]" dir="ltr">
              {stock[a.id] ?? 0}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ─── product list row ─────────────────────────────────────────────────

function ProductRow(props: {
  article: Article;
  stock: number;
  currency: string;
  locale: Locale;
  onTap: () => void;
}): JSX.Element {
  const { article, stock, currency, locale, onTap } = props;
  const outOfStock = stock <= 0;
  return (
    <li>
      <button
        type="button"
        data-testid={`sell-row-${article.internal_code}`}
        onClick={onTap}
        className={`border-hair flex w-full items-center gap-3 rounded-xl border bg-white p-2.5 text-start ${
          outOfStock ? 'opacity-60' : ''
        }`}
      >
        <PhotoThumb photoId={article.photo_id} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-ink line-clamp-1 text-sm font-medium">{article.name}</div>
          <div className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
            {article.internal_code}
          </div>
        </div>
        <span className="text-ink font-mono text-xs tabular-nums" dir="ltr">
          {formatCurrency(article.sale_price_tnd, locale, currency)}
        </span>
        <span
          data-testid={`sell-row-${article.internal_code}-stock`}
          className={`inline-flex items-center gap-0.5 font-mono text-xs tabular-nums ${
            outOfStock ? 'text-bad' : 'text-ink-2'
          }`}
          dir="ltr"
        >
          {stock}
          <ArrowRight aria-hidden className="h-3 w-3" strokeWidth={2.5} />
        </span>
      </button>
    </li>
  );
}

// ─── variant picker bottom sheet ──────────────────────────────────────

function VariantPicker(props: {
  articleId: UUID;
  locale: Locale;
  currency: string;
  onClose: () => void;
  onConfirm: (input: {
    article: Article;
    variant: Variant;
    qty: number;
    unitPriceOverride: number | null;
  }) => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
  tCommon: (k: string) => string;
}): JSX.Element {
  const { articleId, locale, currency, onClose, onConfirm, t, tCommon } = props;
  const [article, setArticle] = useState<Article | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [grid, setGrid] = useState<SizeGridCell[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [unitPriceText, setUnitPriceText] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const a = await db.articles.get(articleId);
      const vs = (await db.variants.toArray()).filter(
        (v) => v.article_id === articleId && v.deleted_at === null,
      );
      const g = await sizeGridFor(db, articleId);
      if (cancelled) return;
      setArticle(a ?? null);
      setVariants(vs);
      setGrid(g);
      // Pre-select the (color, size) cell with the highest stock so the
      // merchant can confirm without scrolling. Ties go to the first
      // alphabetical/numeric variant — deterministic on a re-mount.
      const best = g.slice().sort((p, q) => q.qty - p.qty)[0];
      if (best) {
        setColor(best.color);
        setSize(best.size);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  useEffect(() => {
    if (article && unitPriceText === '') {
      setUnitPriceText(
        article.sale_price_tnd > 0 ? formatCurrency(article.sale_price_tnd, locale, currency) : '',
      );
    }
  }, [article, locale, currency, unitPriceText]);

  const colors = useMemo<Array<string | null>>(() => {
    const seen = new Set<string>();
    const out: Array<string | null> = [];
    for (const cell of grid) {
      const key = cell.color ?? '';
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell.color);
    }
    return out;
  }, [grid]);

  const sizesForColor = useMemo<SizeGridCell[]>(() => {
    return grid.filter((c) => (c.color ?? '') === (color ?? ''));
  }, [grid, color]);

  const activeCell = useMemo<SizeGridCell | null>(() => {
    return (
      grid.find((c) => (c.color ?? '') === (color ?? '') && (c.size ?? '') === (size ?? '')) ?? null
    );
  }, [grid, color, size]);

  const activeVariant = useMemo<Variant | null>(() => {
    if (!activeCell) return null;
    return variants.find((v) => v.id === activeCell.variant_id) ?? null;
  }, [activeCell, variants]);

  if (!article) {
    // Article still loading — render an empty sheet for a frame so the
    // open/close animation runs predictably from the call site.
    return (
      <Dialog.Root open={true} onOpenChange={(o) => !o && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/40" />
          <Dialog.Content className="bg-paper fixed inset-x-0 bottom-0 rounded-t-3xl p-5">
            <Dialog.Title className="sr-only">{t('variant_picker_title')}</Dialog.Title>
            <p className="text-ink-3 text-center text-xs">{tCommon('saving')}</p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  const available = activeCell?.qty ?? 0;
  const overridePrice = parseCurrency(unitPriceText, locale, currency);
  const effectiveUnitPrice =
    overridePrice !== null && overridePrice >= 0 ? overridePrice : article.sale_price_tnd;
  const total = qty * effectiveUnitPrice;
  const canConfirm = qty > 0 && qty <= available && activeVariant !== null;

  return (
    <Dialog.Root open={true} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="sell-variant-picker"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="bg-hair mx-auto mb-3 h-1 w-10 rounded-full" />
          <div className="flex items-start gap-3">
            <PhotoThumb photoId={article.photo_id} size={56} />
            <div className="flex-1">
              <Dialog.Title className="font-display text-base font-semibold">
                {article.name}
              </Dialog.Title>
              <p className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
                {article.internal_code}
              </p>
            </div>
            <Dialog.Close
              type="button"
              data-testid="sell-variant-close"
              className="text-ink-3 -mr-1 -mt-1 inline-flex h-7 w-7 items-center justify-center"
              aria-label={tCommon('close')}
            >
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          {colors.length > 1 || colors[0] !== null ? (
            <div className="mt-4">
              <p className="text-ink-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                {t('variant_color_label')}
              </p>
              <div data-testid="sell-color-row" className="flex flex-wrap gap-1.5">
                {colors.map((c) => (
                  <button
                    key={c ?? '__none'}
                    type="button"
                    data-testid={`sell-color-${c ?? 'none'}`}
                    onClick={() => setColor(c)}
                    aria-pressed={color === c}
                    className={`border-hair rounded-full border px-3 py-1 text-xs ${
                      color === c ? 'bg-ink text-white' : 'bg-white'
                    }`}
                  >
                    {c ?? t('variant_color_default')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {sizesForColor.length > 1 || sizesForColor[0]?.size !== null ? (
            <div className="mt-4">
              <p className="text-ink-3 mb-1.5 text-[11px] font-medium uppercase tracking-wide">
                {t('variant_size_label')}
              </p>
              <div data-testid="sell-size-row" className="flex flex-wrap gap-1.5">
                {sizesForColor.map((cell) => {
                  const selected = (size ?? '') === (cell.size ?? '');
                  const oos = cell.qty <= 0;
                  return (
                    <button
                      key={cell.variant_id || `${cell.color}-${cell.size}`}
                      type="button"
                      data-testid={`sell-size-${cell.size ?? 'none'}`}
                      onClick={() => {
                        setSize(cell.size);
                        setQty(1);
                      }}
                      aria-pressed={selected}
                      className={`border-hair flex flex-col items-center rounded-xl border px-2.5 py-1.5 text-xs ${
                        selected ? 'bg-ink text-white' : 'bg-white'
                      } ${oos ? 'opacity-50' : ''}`}
                    >
                      <span className="font-medium">{cell.size ?? t('variant_size_default')}</span>
                      <span
                        className={`mt-0.5 font-mono text-[10px] tabular-nums ${
                          selected ? 'text-white/80' : 'text-ink-3'
                        }`}
                        dir="ltr"
                      >
                        {cell.qty}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <p data-testid="sell-variant-stock-line" className="text-ink-2 mt-3 text-xs">
            {t('variant_in_stock', { n: available })}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-ink-3 text-xs">{t('variant_qty_label')}</span>
            <button
              type="button"
              data-testid="sell-qty-minus"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="border-hair h-8 w-8 rounded-lg border bg-white text-base"
            >
              <Minus aria-hidden className="mx-auto h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
            <span data-testid="sell-qty-value" className="font-mono text-sm tabular-nums" dir="ltr">
              {qty}
            </span>
            <button
              type="button"
              data-testid="sell-qty-plus"
              onClick={() => setQty((q) => Math.min(available, q + 1))}
              disabled={qty >= available}
              className="border-hair h-8 w-8 rounded-lg border bg-white text-base disabled:opacity-40"
            >
              <Plus aria-hidden className="mx-auto h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>

          <div className="mt-4">
            <label className="text-ink-3 mb-1 block text-xs font-medium">
              {t('unit_price_label')}
            </label>
            <input
              data-testid="picker-unit-price"
              type="text"
              inputMode="decimal"
              value={unitPriceText}
              onChange={(e) => setUnitPriceText(e.target.value)}
              placeholder={t('unit_price_placeholder')}
              className="border-hair w-full rounded-lg border bg-white px-3 py-2 text-sm tabular-nums"
            />
            {article.sale_price_tnd > 0 &&
            overridePrice !== null &&
            overridePrice !== article.sale_price_tnd ? (
              <p className="mt-1 text-xs text-amber-700">
                {t('price_overridden_hint', {
                  original: formatCurrency(article.sale_price_tnd, locale, currency),
                })}
              </p>
            ) : null}
          </div>

          <div className="border-hair text-ink mt-4 flex items-center justify-between border-t pt-3 text-sm font-semibold">
            <span>{t('variant_total_label')}</span>
            <span data-testid="sell-variant-total" className="font-mono tabular-nums" dir="ltr">
              {formatCurrency(total, locale, currency)}
            </span>
          </div>

          <button
            type="button"
            data-testid="sell-confirm"
            disabled={!canConfirm}
            onClick={() => {
              if (!activeVariant) return;
              onConfirm({
                article,
                variant: activeVariant,
                qty,
                unitPriceOverride:
                  overridePrice !== null && overridePrice !== article.sale_price_tnd
                    ? overridePrice
                    : null,
              });
            }}
            className="bg-accent mt-4 w-full rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('variant_confirm')}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── end-session confirmation ─────────────────────────────────────────

function EndSessionDialog(props: {
  open: boolean;
  count: number;
  total: number;
  locale: Locale;
  currency: string;
  onKeep: () => void;
  onEnd: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { open, count, total, locale, currency, onKeep, onEnd, t } = props;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onKeep()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="sell-end-confirm"
          className="bg-paper fixed left-1/2 top-1/2 w-[min(90vw,360px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl p-5 shadow-xl"
        >
          <Dialog.Title className="font-display text-base font-semibold">
            {t('end_session_title')}
          </Dialog.Title>
          <Dialog.Description className="text-ink-2 mt-2 text-sm">
            {t('end_session_body', {
              n: count,
              total: formatCurrency(total, locale, currency),
            })}
          </Dialog.Description>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="sell-end-keep"
              onClick={onKeep}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {t('keep_selling')}
            </button>
            <button
              type="button"
              data-testid="sell-end-confirm-ok"
              onClick={onEnd}
              className="bg-bad flex-1 rounded-xl py-2.5 text-sm font-medium text-white"
            >
              {t('end_session_confirm')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── session summary screen (modal) ───────────────────────────────────

function SessionSummary(props: {
  open: boolean;
  count: number;
  total: number;
  locale: Locale;
  currency: string;
  onBack: () => void;
  onReports: () => void;
  onResume: () => void;
  onCreateInvoice: () => void;
  canCreateInvoice: boolean;
  invoiceInFlight: boolean;
  paymentWarning: string | null;
  documentMode: SaleDocumentMode;
  onDocumentMode: (mode: SaleDocumentMode) => void;
  paymentMode: SalePaymentMode;
  onPaymentMode: (mode: SalePaymentMode) => void;
  partialPaidText: string;
  onPartialPaidText: (value: string) => void;
  partialTotalLabel: string;
  customer: Customer | null;
  sessionSales: readonly {
    article_name: string;
    color: string | null;
    size: string | null;
    qty: number;
    total: number;
  }[];
  sales: readonly SessionSale[];
  onRemoveSale: (movementId: UUID) => void;
  onUpdateQty: (sale: SessionSale, newQty: number) => void;
  onUpdateDiscount: (sale: SessionSale, pct: number | null) => void;
  profile: ShopProfile | null | undefined;
  partialPaidMinor: number | null;
  onNavigateSettings: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const {
    open,
    count,
    total,
    locale,
    currency,
    onBack,
    onReports,
    onResume,
    onCreateInvoice,
    canCreateInvoice,
    invoiceInFlight,
    paymentWarning,
    documentMode,
    onDocumentMode,
    paymentMode,
    onPaymentMode,
    partialPaidText,
    onPartialPaidText,
    partialTotalLabel,
    customer,
    sessionSales,
    sales,
    onRemoveSale,
    onUpdateQty,
    onUpdateDiscount,
    profile,
    partialPaidMinor,
    onNavigateSettings,
    t,
  } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onResume()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          data-testid="sell-session-summary"
          className="bg-paper fixed inset-x-3 top-1/2 -translate-y-1/2 rounded-3xl p-6 shadow-xl sm:left-1/2 sm:right-auto sm:w-[420px] sm:-translate-x-1/2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 aria-hidden className="text-good h-6 w-6" strokeWidth={2} />
            <Dialog.Title className="font-display text-base font-semibold">
              {t('session_complete')}
            </Dialog.Title>
          </div>

          <div className="bg-paper-deep mt-4 grid grid-cols-2 gap-3 rounded-2xl p-4">
            <div>
              <p className="text-ink-3 text-[11px] uppercase tracking-wide">
                {t('summary_sales_label')}
              </p>
              <p
                data-testid="sell-summary-count"
                className="text-ink font-display mt-1 text-2xl"
                dir="ltr"
              >
                {count}
              </p>
            </div>
            <div>
              <p className="text-ink-3 text-[11px] uppercase tracking-wide">
                {t('summary_revenue_label')}
              </p>
              <p
                data-testid="sell-summary-total"
                className="text-ink font-display mt-1 text-2xl"
                dir="ltr"
              >
                {formatCurrency(total, locale, currency)}
              </p>
            </div>
          </div>

          {/* Editable cart rows */}
          <div
            data-testid="cart-items"
            className="border-hair mt-4 max-h-[35vh] overflow-y-auto rounded-2xl border bg-white"
          >
            {sales.length === 0 ? (
              <p className="text-ink-3 px-4 py-3 text-center text-sm">{t('cart_empty')}</p>
            ) : (
              <ul className="divide-hair divide-y px-1">
                {sales.map((sale) => {
                  const label = [sale.color, sale.size]
                    .filter((p): p is string => typeof p === 'string' && p.length > 0)
                    .join(' · ');
                  return (
                    <li
                      key={sale.movement_id}
                      data-testid={`cart-row-${sale.movement_id}`}
                      className="flex items-center gap-2 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-ink truncate text-sm font-medium">{sale.article_name}</p>
                        {label ? (
                          <p className="text-ink-3 text-xs">{label}</p>
                        ) : (
                          <p className="text-ink-3 font-mono text-xs">{sale.internal_code}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`cart-qty-minus-${sale.movement_id}`}
                          onClick={() => onUpdateQty(sale, sale.qty - 1)}
                          aria-label={t('decrease_qty')}
                          className="border-hair h-7 w-7 rounded-md border text-sm leading-none"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{sale.qty}</span>
                        <button
                          type="button"
                          data-testid={`cart-qty-plus-${sale.movement_id}`}
                          onClick={() => onUpdateQty(sale, sale.qty + 1)}
                          aria-label={t('increase_qty')}
                          className="border-hair h-7 w-7 rounded-md border text-sm leading-none"
                        >
                          +
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <input
                          data-testid={`cart-discount-${sale.movement_id}`}
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={sale.discount_pct ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Number(e.target.value);
                            onUpdateDiscount(sale, v);
                          }}
                          placeholder="0%"
                          className="border-hair w-12 rounded-md border bg-white px-1.5 py-1 text-end text-xs tabular-nums"
                          aria-label={t('discount_aria')}
                        />
                        <span className="text-ink-2 w-20 text-end text-sm tabular-nums" dir="ltr">
                          {formatCurrency(sale.total, locale, currency)}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid={`cart-remove-${sale.movement_id}`}
                        onClick={() => onRemoveSale(sale.movement_id)}
                        aria-label={t('remove_item')}
                        className="text-ink-3 hover:text-bad ms-1 p-1"
                      >
                        <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-hair mt-4 space-y-3 rounded-2xl border bg-white p-3">
            <div>
              <p className="text-ink-3 text-[11px] uppercase tracking-wide">
                {t('summary_document_label')}
              </p>
              <p className="text-ink-3 mt-1 text-xs">
                {customer ? customer.name : t('customer_walk_in')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(['receipt', 'invoice'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`sell-summary-document-${mode}`}
                  onClick={() => onDocumentMode(mode)}
                  aria-pressed={documentMode === mode}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    documentMode === mode
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-hair bg-white text-ink-2'
                  }`}
                >
                  {t(`document_${mode}`)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(['paid', 'partial', 'unpaid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`sell-summary-payment-${mode}`}
                  onClick={() => onPaymentMode(mode)}
                  aria-pressed={paymentMode === mode}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-semibold ${
                    paymentMode === mode
                      ? 'border-accent bg-accent text-white'
                      : 'border-hair bg-white text-ink-2'
                  }`}
                >
                  {t(`payment_${mode}`)}
                </button>
              ))}
            </div>

            {(paymentMode === 'partial' || paymentMode === 'unpaid') && total === 0 ? (
              <p
                data-testid="payment-mode-empty-hint"
                className="text-ink-3 mt-2 text-[11px] leading-relaxed"
              >
                {t(
                  paymentMode === 'partial' ? 'partial_empty_cart_hint' : 'unpaid_empty_cart_hint',
                )}
              </p>
            ) : null}

            {paymentMode === 'partial' && total > 0 ? (
              <div>
                <label
                  htmlFor="sell-summary-partial-paid"
                  className="text-ink-3 mb-1 block text-[11px] font-medium uppercase tracking-wide"
                >
                  {t('partial_paid_label')}
                </label>
                <input
                  id="sell-summary-partial-paid"
                  data-testid="sell-summary-partial-paid"
                  type="text"
                  inputMode="decimal"
                  value={partialPaidText}
                  onChange={(event) => onPartialPaidText(event.target.value)}
                  placeholder={t('partial_paid_placeholder')}
                  className="border-hair text-ink w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm"
                />
                <p className="text-ink-3 mt-1 text-xs">
                  {t('partial_paid_hint', { total: partialTotalLabel })}
                </p>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            data-testid="sell-summary-create-invoice"
            onClick={() => setPreviewOpen(true)}
            disabled={!canCreateInvoice || invoiceInFlight}
            className="bg-ink mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            <FileText aria-hidden className="h-4 w-4" strokeWidth={2.25} />
            {t('summary_preview_button')}
          </button>

          <InvoicePreviewModal
            open={previewOpen}
            onClose={() => setPreviewOpen(false)}
            onConfirm={() => {
              setPreviewOpen(false);
              onCreateInvoice();
            }}
            onNavigateSettings={() => {
              setPreviewOpen(false);
              onNavigateSettings();
            }}
            sessionSales={sessionSales}
            documentMode={documentMode}
            paymentMode={paymentMode}
            customer={customer}
            partialPaidMinor={partialPaidMinor}
            sessionRevenue={total}
            profile={profile}
            currency={currency}
            locale={locale}
            t={t}
          />
          {paymentWarning ? (
            <p className="text-bad mt-2 text-center text-xs" role="alert">
              {paymentWarning}
            </p>
          ) : null}

          <button
            type="button"
            data-testid="sell-summary-back"
            onClick={onBack}
            className="bg-accent mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-white"
          >
            <ArrowLeft aria-hidden className="h-4 w-4" strokeWidth={2.5} />
            {t('summary_back_to_products')}
          </button>

          <button
            type="button"
            data-testid="sell-summary-reports"
            onClick={onReports}
            className="text-accent mt-3 block w-full text-center text-sm font-medium"
          >
            {t('summary_view_reports')}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
