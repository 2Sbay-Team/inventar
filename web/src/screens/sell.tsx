import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, ShoppingCart, Trash2, X } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useBarcodeStream } from '../hooks/use-barcode-stream';
import { useCurrency } from '../hooks/use-currency';
import { useEanValidator } from '../hooks/use-ean-validator';
import { useLocale } from '../hooks/use-locale';
import { useProfile } from '../hooks/use-profile';
import { STORE_TYPES } from '../config/store-types';
import { findArticleByEAN } from '../repos/articles';
import { recordMovement } from '../repos/movements';
import { pickFifoLot } from '../repos/lots';
import { quantityFor } from '../repos/quantity';
import { isPlausibleScannableCode } from '../utils/ean';
import { newUUID } from '../utils/uuid';
import { formatCurrency } from '../i18n/format-currency';
import { type Article, type Locale, type UUID } from '../types';

// v0.5 ADR-018 + ADR-019: scan-driven checkout. Mirror of /receive's
// camera shape, but instead of one-scan-one-write the merchant builds a
// cart of items first and commits the whole transaction at the end.
//
// Cart semantics
//   - One row per Article (subsequent scans of the same EAN bump the
//     row's qty rather than adding a duplicate row).
//   - Each row carries the FIFO Lot picked at the moment the row was
//     first added — earliest expires_at with remaining > 0. Null for
//     non-perishable items. Sticking the lot to the row at add-time
//     (rather than at Done) keeps the audit trail intuitive: what the
//     merchant saw on the cart is what the Movement attributes to.
//   - On Done, one sale Movement per cart row: delta=-row.qty,
//     type='sale', location='floor', transaction_id=session,
//     lot_id=row.lot_id, unit_price_tnd=null (uses article's catalogue
//     price; per-sale discounts go through the Quick Adjust path).
//
// Note: the v0.5 brief's test-38 description says "three sale
// Movements" from a 2-scan + 1-scan sequence, but the same brief's
// design text says "Create one Movement per cart item: delta=-quantity".
// We follow the design text (one Movement per cart ROW with
// delta=-qty) — the alternative would lose the "cart" abstraction
// altogether and write per-scan, which contradicts the cart-aggregated
// drawer the merchant actually sees.
//
// Sized articles (clothes / shoes with barcode_ean): out of scope for
// scan-driven sale. We surface a toast and leave the cart untouched —
// the merchant should open the article via Search and use Quick Adjust,
// which already handles per-(colour, size) sale.
//
// Camera + BarcodeDetector wiring lives in useBarcodeStream — shared
// with /receive. The hook handles the cooldown + e2e CustomEvent
// listener; this screen just calls into it with its own onDetect +
// isBlocked predicate.

interface CartRow {
  variant_id: UUID;
  article_id: UUID;
  article_name: string;
  internal_code: string;
  unit_price_tnd: number; // millimes
  qty: number;
  lot_id: UUID | null;
  available: number; // computed at add-time, not refreshed per scan
}

type ManualState = null | 'open';

export function SellScreen(): JSX.Element {
  const { t } = useTranslation('sell');
  const { t: tCommon } = useTranslation('common');
  const { locale } = useLocale();
  const currency = useCurrency();
  const profile = useProfile();
  const navigate = useNavigate();
  const sessionIdRef = useRef<UUID>(newUUID());

  const [cart, setCart] = useState<CartRow[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [manual, setManual] = useState<ManualState>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const validate = useEanValidator();

  // Suppress further detections while the manual sheet is open OR the
  // expanded cart drawer is up — prevents accidental adds. Mirrored
  // into a ref so the hook's blocked predicate reads the latest value
  // without re-mounting the camera.
  const dispatchBlockedRef = useRef(false);
  useEffect(() => {
    dispatchBlockedRef.current = manual !== null || cartOpen;
  }, [manual, cartOpen]);

  // Mirror cart state in a ref so the camera + e2e listener closures
  // (attached at mount time, deps=[]) can read the LATEST cart when
  // deciding whether to bump an existing row vs add a new one. Without
  // this, repeated scans always read cart=[] (the mount-time closure)
  // and produce one row per scan instead of incrementing.
  const cartRef = useRef<CartRow[]>([]);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Camera + e2e listener call this — they're suppressed while a sheet
  // is open so accidental detections during interaction don't pollute
  // the cart. Manual entry uses processBarcode directly so the user's
  // explicit submit always runs.
  function ingestBarcode(rawValue: string): void {
    if (dispatchBlockedRef.current) return;
    processBarcode(rawValue);
  }

  function processBarcode(value: string): void {
    // Hook already normalises whitespace before dispatching; the
    // manual-entry path also pre-trims via runSearch's
    // isPlausibleScannableCode check, so we can validate directly.
    if (!validate(value)) {
      setScanError(t('scan_invalid'));
      return;
    }
    setScanError(null);
    void resolveAndAdd(value);
  }

  async function resolveAndAdd(ean: string): Promise<void> {
    try {
      await resolveAndAddInner(ean);
    } catch (e) {
      // Surface async failures (Dexie errors, promise rejections) so
      // the user sees something rather than a silent dead cart. Without
      // this catch, fire-and-forget resolveAndAdd swallows everything.
      // Logged to console for debugging; user-visible message stays
      // generic so it's understandable in any locale.

      console.error('sell.resolveAndAdd failed', e);
      setScanError(t('scan_internal_error'));
    }
  }

  async function resolveAndAddInner(ean: string): Promise<void> {
    const article = await findArticleByEAN(db, ean);
    if (!article) {
      setScanError(t('scan_unknown'));
      return;
    }
    // Sized vertical with EAN = ambiguous which variant. Reject + route
    // to manual open of the article. Decision per the v0.5 plan, Q-E.
    const variants = await db.variants
      .where('article_id')
      .equals(article.id)
      .filter((v) => v.deleted_at === null)
      .toArray();
    if (variants.length > 1) {
      setScanError(t('scan_sized_multi'));
      return;
    }
    const variant = variants[0];
    if (!variant) {
      setScanError(t('scan_unknown'));
      return;
    }
    // Same article already in cart → bump qty. Read from cartRef so
    // mount-time closures see the LATEST cart, not the empty one
    // captured at first render.
    const existing = cartRef.current.find((r) => r.variant_id === variant.id);
    if (existing) {
      const stock = await quantityFor(db, variant.id);
      if (existing.qty + 1 > stock) {
        setScanError(t('scan_out_of_stock'));
        return;
      }
      setCart((c) =>
        c.map((r) =>
          r.variant_id === variant.id ? { ...r, qty: r.qty + 1, available: stock } : r,
        ),
      );
      return;
    }
    const stock = await quantityFor(db, variant.id);
    if (stock <= 0) {
      setScanError(t('scan_out_of_stock'));
      return;
    }
    const lot = await pickFifoLot(db, variant.id);
    setCart((c) => [
      ...c,
      {
        variant_id: variant.id,
        article_id: article.id,
        article_name: article.name,
        internal_code: article.internal_code,
        unit_price_tnd: article.sale_price_tnd,
        qty: 1,
        lot_id: lot?.id ?? null,
        available: stock,
      },
    ]);
  }

  const {
    videoRef,
    supported,
    error: scannerError,
  } = useBarcodeStream({
    onDetect: ingestBarcode,
    isBlocked: () => dispatchBlockedRef.current,
  });

  // ─── cart actions ───────────────────────────────────────────────────
  function removeRow(variantId: UUID): void {
    setCart((c) => c.filter((r) => r.variant_id !== variantId));
  }

  async function adjustQty(variantId: UUID, nextQty: number): Promise<void> {
    if (nextQty <= 0) {
      removeRow(variantId);
      return;
    }
    const row = cart.find((r) => r.variant_id === variantId);
    if (!row) return;
    if (nextQty > row.available) {
      setScanError(t('scan_out_of_stock'));
      return;
    }
    setCart((c) => c.map((r) => (r.variant_id === variantId ? { ...r, qty: nextQty } : r)));
  }

  async function commitSale(): Promise<void> {
    if (cart.length === 0) return;
    setSubmitting(true);
    try {
      for (const row of cart) {
        await recordMovement(db, {
          variant_id: row.variant_id,
          delta: -row.qty,
          type: 'sale',
          location: 'floor',
          transaction_id: sessionIdRef.current,
          lot_id: row.lot_id,
          // v0.5.1: snapshot the catalogue price at sale time. Future
          // returns linked to this sale will refund the same amount
          // even if Article.sale_price_tnd is changed later.
          unit_price_tnd: row.unit_price_tnd,
        });
      }
      navigate('/', { replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  const cartCount = cart.reduce((s, r) => s + r.qty, 0);
  const cartTotal = cart.reduce((s, r) => s + r.qty * r.unit_price_tnd, 0);

  // ─── render ─────────────────────────────────────────────────────────
  void profile;
  void STORE_TYPES;
  return (
    <ScreenLayout hideNav>
      <header className="border-hair grid grid-cols-3 items-center border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="sell-cancel"
          onClick={() => navigate('/', { replace: true })}
          className="text-ink-3 justify-self-start text-xs font-medium"
        >
          {tCommon('cancel')}
        </button>
        <h3 className="font-display inline-flex items-center justify-center gap-1.5 justify-self-center text-sm font-semibold tracking-tight">
          <ShoppingCart aria-hidden className="text-accent h-4 w-4" strokeWidth={2.25} />
          {t('title')}
        </h3>
        <button
          type="button"
          data-testid="sell-cart-toggle"
          onClick={() => setCartOpen(true)}
          className="text-ink-3 justify-self-end font-mono text-[11px]"
          dir="ltr"
        >
          {t('cart_toggle', {
            n: cartCount,
            total: formatCurrency(cartTotal, locale, currency),
          })}
        </button>
      </header>

      <main
        data-testid="sell-screen"
        className="bg-ink relative flex flex-1 flex-col overflow-hidden"
      >
        {!supported ? (
          <div className="text-ink-2 bg-paper m-6 rounded-2xl border p-6 text-center text-sm">
            {t('scanner_unsupported_short')}
          </div>
        ) : scannerError ? (
          <div className="text-bad bg-paper m-6 rounded-2xl border p-6 text-center text-sm">
            <p className="font-medium">{t('scanner_error_short')}</p>
            <p className="text-ink-3 mt-1 text-xs">{scannerError}</p>
          </div>
        ) : (
          <div className="relative flex-1 overflow-hidden bg-black">
            <video
              ref={videoRef}
              data-testid="sell-video"
              playsInline
              muted
              className="h-full w-full object-cover"
              aria-label={t('title')}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="border-accent/80 h-48 w-48 rounded-2xl border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
            </div>
          </div>
        )}

        {scanError ? (
          <p
            data-testid="sell-scan-error"
            className="text-bad bg-bad/10 border-bad/30 absolute left-3 right-3 top-3 rounded-xl border px-3 py-2 text-center text-xs"
            role="alert"
          >
            {scanError}
          </p>
        ) : null}

        {/* Peek strip: small confirmation each time the cart changes */}
        {cart.length > 0 ? (
          <button
            type="button"
            data-testid="sell-cart-peek"
            onClick={() => setCartOpen(true)}
            className="bg-accent absolute bottom-20 left-3 right-3 inline-flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg"
          >
            <span>{t('peek_count', { n: cartCount })}</span>
            <span className="font-mono tabular-nums" dir="ltr">
              {formatCurrency(cartTotal, locale, currency)}
            </span>
          </button>
        ) : null}

        <button
          type="button"
          data-testid="sell-type-instead"
          onClick={() => setManual('open')}
          className="bg-ink absolute bottom-5 right-5 inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <Keyboard aria-hidden className="h-4 w-4" strokeWidth={2.25} />
          {t('type_instead')}
        </button>
      </main>

      {manual === 'open' ? (
        <ManualEntrySheet
          open={true}
          onClose={() => setManual(null)}
          onSubmit={(value) => {
            setManual(null);
            // Bypass the dispatch gate: the user's explicit submit IS
            // the scan they want, even though dispatchBlockedRef will
            // still read true until the next render commits.
            processBarcode(value);
          }}
          tCommon={tCommon}
          t={t}
        />
      ) : null}

      {cartOpen ? (
        <CartDrawer
          open={true}
          rows={cart}
          total={cartTotal}
          locale={locale}
          currency={currency}
          submitting={submitting}
          onClose={() => setCartOpen(false)}
          onAdjust={(id, n) => void adjustQty(id, n)}
          onRemove={(id) => removeRow(id)}
          onContinue={() => setCartOpen(false)}
          onDone={() => void commitSale()}
          tCommon={tCommon}
          t={t}
        />
      ) : null}
    </ScreenLayout>
  );
}

// ─── manual entry ─────────────────────────────────────────────────────

function ManualEntrySheet(props: {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  tCommon: (k: string) => string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { open, onClose, onSubmit, tCommon, t } = props;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Article[]>([]);
  const [searched, setSearched] = useState(false);

  async function runSearch(): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    if (isPlausibleScannableCode(trimmed)) {
      // Defer to the scan path for any plausible barcode.
      onSubmit(trimmed);
      return;
    }
    const all = await db.articles.toArray();
    const lower = trimmed.toLowerCase();
    const matches = all.filter(
      (a) =>
        a.deleted_at === null &&
        a.archived_at === null &&
        (a.internal_code.toLowerCase().includes(lower) ||
          a.name.toLowerCase().includes(lower) ||
          (a.barcode_ean ?? '').includes(trimmed)),
    );
    setResults(matches);
    setSearched(true);
  }

  function pickResult(a: Article): void {
    if (a.barcode_ean) {
      onSubmit(a.barcode_ean);
    } else {
      onSubmit(a.internal_code);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="sell-manual-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-display text-base font-semibold">
              {t('type_instead')}
            </Dialog.Title>
            <Dialog.Close type="button" data-testid="sell-manual-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>
          <input
            data-testid="sell-manual-input"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearched(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch();
            }}
            placeholder={t('search_placeholder')}
            className="border-hair w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              data-testid="sell-manual-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="sell-manual-submit"
              onClick={() => void runSearch()}
              disabled={query.trim().length === 0}
              className="bg-ink flex-1 rounded-xl py-2.5 text-sm text-white disabled:opacity-50"
            >
              {tCommon('continue')}
            </button>
          </div>
          {searched ? (
            results.length === 0 ? (
              <p data-testid="sell-manual-no-match" className="text-ink-3 mt-3 text-center text-xs">
                {t('search_no_match', { query })}
              </p>
            ) : (
              <ul data-testid="sell-manual-results" className="mt-3 space-y-2">
                {results.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      data-testid={`sell-manual-result-${a.internal_code}`}
                      onClick={() => pickResult(a)}
                      className="border-hair w-full rounded-xl border bg-white p-3 text-start"
                    >
                      <div className="text-ink text-sm font-medium">{a.name}</div>
                      <div className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
                        {a.internal_code}
                        {a.barcode_ean ? ` · ${a.barcode_ean}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── cart drawer ──────────────────────────────────────────────────────

function CartDrawer(props: {
  open: boolean;
  rows: CartRow[];
  total: number;
  locale: Locale;
  currency: string;
  submitting: boolean;
  onClose: () => void;
  onAdjust: (variantId: UUID, nextQty: number) => void;
  onRemove: (variantId: UUID) => void;
  onContinue: () => void;
  onDone: () => void;
  tCommon: (k: string) => string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const {
    open,
    rows,
    total,
    locale,
    currency,
    submitting,
    onClose,
    onAdjust,
    onRemove,
    onContinue,
    onDone,
    tCommon,
    t,
  } = props;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="sell-cart-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-display text-base font-semibold">
              {t('cart_title')}
            </Dialog.Title>
            <Dialog.Close type="button" data-testid="sell-cart-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>
          {rows.length === 0 ? (
            <p data-testid="sell-cart-empty" className="text-ink-3 mt-2 text-center text-xs">
              {t('cart_empty')}
            </p>
          ) : (
            <ul data-testid="sell-cart-rows" className="space-y-2">
              {rows.map((row) => (
                <li
                  key={row.variant_id}
                  data-testid={`sell-cart-row-${row.internal_code}`}
                  className="border-hair flex items-center justify-between rounded-xl border bg-white p-3"
                >
                  <div className="flex flex-1 flex-col">
                    <div className="text-ink text-sm font-medium">{row.article_name}</div>
                    <div className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
                      {row.internal_code} · ×{row.qty}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`sell-cart-row-${row.internal_code}-minus`}
                      onClick={() => onAdjust(row.variant_id, row.qty - 1)}
                      className="bg-paper border-hair h-8 w-8 rounded-lg border text-base"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      data-testid={`sell-cart-row-${row.internal_code}-plus`}
                      onClick={() => onAdjust(row.variant_id, row.qty + 1)}
                      className="bg-paper border-hair h-8 w-8 rounded-lg border text-base"
                    >
                      +
                    </button>
                    <span
                      data-testid={`sell-cart-row-${row.internal_code}-line`}
                      className="font-mono text-sm tabular-nums"
                      dir="ltr"
                    >
                      {formatCurrency(row.qty * row.unit_price_tnd, locale, currency)}
                    </span>
                    <button
                      type="button"
                      data-testid={`sell-cart-row-${row.internal_code}-remove`}
                      onClick={() => onRemove(row.variant_id)}
                      className="text-ink-3"
                      aria-label={t('cart_remove')}
                    >
                      <Trash2 aria-hidden className="h-4 w-4" strokeWidth={2} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 ? (
            <div className="border-hair text-ink mt-3 flex items-center justify-between border-t pt-3 text-base font-semibold">
              <span>{t('cart_total')}</span>
              <span data-testid="sell-cart-total" className="font-mono tabular-nums" dir="ltr">
                {formatCurrency(total, locale, currency)}
              </span>
            </div>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="sell-continue-scanning"
              onClick={onContinue}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {t('continue_scanning')}
            </button>
            <button
              type="button"
              data-testid="sell-done"
              disabled={rows.length === 0 || submitting}
              onClick={onDone}
              className="bg-accent flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {tCommon('save')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
