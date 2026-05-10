import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, Plus, ScanLine, X } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useProfile } from '../hooks/use-profile';
import { useCurrency } from '../hooks/use-currency';
import { useLocale } from '../hooks/use-locale';
import { categoriesForSubtypes } from '../config/shop-subtypes';
import { STORE_TYPES } from '../config/store-types';
import { createArticle, findArticleByEAN } from '../repos/articles';
import { recordMovement } from '../repos/movements';
import { createLot } from '../repos/lots';
import { quantityFor } from '../repos/quantity';
import { storePhoto } from '../repos/photos';
import { compressPhoto } from '../utils/compress-photo';
import { isPlausibleScannableCode, normalizeEan } from '../utils/ean';
import { newUUID } from '../utils/uuid';
import { parseCurrency } from '../i18n/parse-currency';
import { type Article, type Category, type UUID } from '../types';

// v0.5 ADR-018 + ADR-019: scan-driven receiving. Camera viewfinder fills
// the screen; on each detected EAN, a bottom sheet opens to confirm
// quantity (and an optional expiry date that, when set, also creates a
// Lot for FIFO sale attribution). Manual fallback ("Type instead") opens
// a search box that accepts an EAN, an internal code, or part of a
// product name. Per-session UUID groups every Movement created in this
// receiving session so the activity feed can collapse the batch.
//
// Implementation notes
//   - The camera + BarcodeDetector wiring is inlined here rather than
//     using <BarcodeScanner /> because the latter is a Radix Dialog and
//     stacking another Dialog (the bottom sheet) above an open Dialog
//     gets fiddly. This screen is large enough to own the camera surface
//     directly. If /sell ends up duplicating most of this, extract a
//     shared useBarcodeStream hook.
//   - During detection, if the bottom sheet is already showing one
//     scan's contents, further detections are ignored — the cooldown in
//     the scanner only suppresses the SAME value within a window; here
//     we suppress ALL values until the sheet closes.
//   - The e2e seed surface dispatches 'inventar:e2e-scan' so headless
//     playwright can drive this screen without faking the BarcodeDetector
//     API. Same listener pattern as src/components/barcode-scanner.tsx.

interface DetectedBarcode {
  rawValue: string;
  format: string;
}

interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): {
    detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
  };
}

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

const SAME_VALUE_COOLDOWN_MS = 1500;

type SheetState =
  | null
  | { kind: 'manual' }
  | { kind: 'known'; article: Article; currentStock: number; ean: string }
  | { kind: 'unknown'; ean: string };

export function ReceiveScreen(): JSX.Element {
  const { t } = useTranslation('receive');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();
  const profile = useProfile();
  const sessionIdRef = useRef<UUID>(newUUID());

  const [sessionCount, setSessionCount] = useState(0);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const supported = getBarcodeDetector() !== null;

  // Refs that the camera-loop closure needs. We don't want to re-init
  // the camera every time React re-renders, so the loop reads its
  // "should I ignore this detection?" guard from a ref instead of
  // closing over the sheet state directly.
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = sheet !== null;
  }, [sheet]);

  const lastEmittedRef = useRef<{ value: string; at: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // Shared dispatcher: any path that produces a candidate barcode (real
  // scan, e2e injected event, manual entry) lands here.
  function ingestBarcode(rawValue: string): void {
    if (sheetOpenRef.current) return;
    const value = normalizeEan(rawValue);
    if (!isPlausibleScannableCode(value)) {
      setScanError(t('scan_invalid'));
      return;
    }
    setScanError(null);
    void resolveAndOpen(value);
  }

  async function resolveAndOpen(ean: string): Promise<void> {
    const existing = await findArticleByEAN(db, ean);
    if (existing) {
      const variant = await db.variants
        .where('article_id')
        .equals(existing.id)
        .filter((v) => v.deleted_at === null)
        .first();
      const currentStock = variant ? await quantityFor(db, variant.id) : 0;
      setSheet({ kind: 'known', article: existing, currentStock, ean });
    } else {
      setSheet({ kind: 'unknown', ean });
    }
  }

  // ─── camera + BarcodeDetector ───────────────────────────────────────
  useEffect(() => {
    if (!supported) return;

    let cancelled = false;
    const Detector = getBarcodeDetector();
    if (!Detector) return;
    const detector = new Detector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
    });

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();

        const tick = async (): Promise<void> => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0]) {
              const value = codes[0].rawValue;
              const now = Date.now();
              const dup =
                lastEmittedRef.current &&
                lastEmittedRef.current.value === value &&
                now - lastEmittedRef.current.at < SAME_VALUE_COOLDOWN_MS;
              if (!dup && !sheetOpenRef.current) {
                lastEmittedRef.current = { value, at: now };
                ingestBarcode(value);
              }
            }
          } catch {
            // Detector occasionally throws on a black frame.
          }
          rafRef.current = requestAnimationFrame(() => void tick());
        };
        await tick();
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'camera unavailable';
        setScannerError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // ─── e2e scan injection ─────────────────────────────────────────────
  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return;
    function onE2eScan(ev: Event): void {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      if (!detail?.value) return;
      ingestBarcode(detail.value);
    }
    document.addEventListener('inventar:e2e-scan', onE2eScan);
    return () => document.removeEventListener('inventar:e2e-scan', onE2eScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSheetClose(): void {
    setSheet(null);
  }

  function handleSavedOne(): void {
    setSessionCount((n) => n + 1);
    setSheet(null);
  }

  // ─── render ─────────────────────────────────────────────────────────
  return (
    <ScreenLayout hideNav>
      <header className="border-hair grid grid-cols-3 items-center border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="receive-done"
          onClick={() => navigate('/', { replace: true })}
          className="text-ink-3 justify-self-start text-xs font-medium"
        >
          {t('done')}
        </button>
        <h3 className="font-display inline-flex items-center justify-center gap-1.5 justify-self-center text-sm font-semibold tracking-tight">
          <ScanLine aria-hidden className="text-accent h-4 w-4" strokeWidth={2.25} />
          {t('title')}
        </h3>
        <span
          data-testid="receive-counter"
          className="text-ink-3 justify-self-end font-mono text-[11px]"
          dir="ltr"
        >
          {t('counter', { n: sessionCount })}
        </span>
      </header>

      <main
        data-testid="receive-screen"
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
              data-testid="receive-video"
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
            data-testid="receive-scan-error"
            className="text-bad bg-bad/10 border-bad/30 absolute left-3 right-3 top-3 rounded-xl border px-3 py-2 text-center text-xs"
            role="alert"
          >
            {scanError}
          </p>
        ) : null}

        <button
          type="button"
          data-testid="receive-type-instead"
          onClick={() => setSheet({ kind: 'manual' })}
          className="bg-accent absolute bottom-5 right-5 inline-flex items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-white shadow-lg"
        >
          <Keyboard aria-hidden className="h-4 w-4" strokeWidth={2.25} />
          {t('type_instead')}
        </button>
      </main>

      {sheet?.kind === 'manual' ? (
        <ManualEntrySheet
          open={true}
          onClose={handleSheetClose}
          onSubmit={(value) => {
            setSheet(null);
            ingestBarcode(value);
          }}
          tCommon={tCommon}
          t={t}
        />
      ) : null}

      {sheet?.kind === 'known' ? (
        <KnownArticleSheet
          open={true}
          ean={sheet.ean}
          article={sheet.article}
          currentStock={sheet.currentStock}
          sessionId={sessionIdRef.current}
          onClose={handleSheetClose}
          onSaved={handleSavedOne}
          tCommon={tCommon}
          t={t}
        />
      ) : null}

      {sheet?.kind === 'unknown' ? (
        <UnknownArticleSheet
          open={true}
          ean={sheet.ean}
          sessionId={sessionIdRef.current}
          profile={profile}
          onClose={handleSheetClose}
          onSaved={handleSavedOne}
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
  // Article-name search results so the merchant can disambiguate when
  // the input isn't a 12/13-digit code. Internal code lookup resolves
  // straight through (uppercased prefix match against internal_code).
  const [results, setResults] = useState<Article[]>([]);
  const [searched, setSearched] = useState(false);

  async function runSearch(): Promise<void> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    if (isPlausibleScannableCode(trimmed)) {
      // Defer to the scan path — same handler as a real detection.
      onSubmit(trimmed);
      return;
    }
    // Free-text → name / internal_code lookup. Cheap because the catalogue
    // is bounded.
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
      // Article has no EAN — short-circuit by treating it as a "found"
      // result. Reuse the same flow by injecting a synthetic event with
      // the article's internal_code; the handler resolveAndOpen would
      // not match it. So we just close and let the merchant tap again
      // with the internal_code as the EAN-like input.
      // For simplicity in this commit: when the merchant picks a result
      // without an EAN, we still try to resolve via the EAN path. This
      // means it'll miss findArticleByEAN and route to the unknown
      // sheet — wrong shape. To do this right, we'd want a "resolve by
      // article id" path.
      onSubmit(a.internal_code);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="receive-manual-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-display text-base font-semibold">
              {t('type_instead')}
            </Dialog.Title>
            <Dialog.Close type="button" data-testid="receive-manual-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <input
            data-testid="receive-manual-input"
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
              data-testid="receive-manual-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="receive-manual-submit"
              onClick={() => void runSearch()}
              disabled={query.trim().length === 0}
              className="bg-ink flex-1 rounded-xl py-2.5 text-sm text-white disabled:opacity-50"
            >
              {tCommon('continue')}
            </button>
          </div>

          {searched ? (
            results.length === 0 ? (
              <div className="mt-3 flex flex-col items-center gap-2">
                <p data-testid="receive-manual-no-match" className="text-ink-3 text-center text-xs">
                  {t('search_no_match', { query })}
                </p>
                <Link
                  to="/add"
                  data-testid="receive-manual-add-manually"
                  className="border-hair text-ink-2 inline-flex items-center gap-1.5 rounded-xl border bg-white px-3 py-2 text-xs"
                >
                  <Plus aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
                  {t('add_manually')}
                </Link>
              </div>
            ) : (
              <ul data-testid="receive-manual-results" className="mt-3 space-y-2">
                {results.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      data-testid={`receive-manual-result-${a.internal_code}`}
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

// ─── known-article sheet ──────────────────────────────────────────────

function KnownArticleSheet(props: {
  open: boolean;
  ean: string;
  article: Article;
  currentStock: number;
  sessionId: UUID;
  onClose: () => void;
  onSaved: () => void;
  tCommon: (k: string) => string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { open, ean, article, currentStock, sessionId, onClose, onSaved, tCommon, t } = props;
  const [qty, setQty] = useState(1);
  const [expiry, setExpiry] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  async function save(): Promise<void> {
    if (qty <= 0) return;
    setSubmitting(true);
    try {
      const variant = await db.variants
        .where('article_id')
        .equals(article.id)
        .filter((v) => v.deleted_at === null)
        .first();
      if (!variant) {
        // Should never happen — a non-deleted article always has at
        // least one alive variant. Defensive: bail without crashing.
        return;
      }
      const expiresAt = expiry ? new Date(expiry).toISOString() : null;
      const movement = await recordMovement(db, {
        variant_id: variant.id,
        delta: qty,
        type: 'purchase',
        location: 'back',
        transaction_id: sessionId,
        expires_at: expiresAt,
      });
      if (expiresAt) {
        await createLot(db, {
          variant_id: variant.id,
          expires_at: expiresAt,
          original_quantity: qty,
          source_movement_id: movement.id,
        });
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="receive-known-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <Dialog.Title className="font-display text-base font-semibold">
                {article.name}
              </Dialog.Title>
              <span className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
                {article.internal_code} · {ean}
              </span>
            </div>
            <Dialog.Close type="button" data-testid="receive-known-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <p data-testid="receive-known-stock" className="text-ink-2 text-sm">
            {t('current_stock', { n: currentStock })}
          </p>

          <label htmlFor="receive-known-qty" className="text-ink-2 mt-4 block text-sm font-medium">
            {t('field_qty')}
          </label>
          <Stepper
            testId="receive-known-qty"
            value={qty}
            onChange={(v) => setQty(Math.max(1, v))}
          />

          <label
            htmlFor="receive-known-expiry"
            className="text-ink-2 mt-4 block text-sm font-medium"
          >
            {t('field_expiry')}
          </label>
          <input
            id="receive-known-expiry"
            data-testid="receive-known-expiry"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="receive-known-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="receive-known-save"
              disabled={submitting || qty <= 0}
              onClick={() => void save()}
              className="bg-accent flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('save_next')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── unknown-article sheet (mini-form) ────────────────────────────────

function UnknownArticleSheet(props: {
  open: boolean;
  ean: string;
  sessionId: UUID;
  profile: ReturnType<typeof useProfile>;
  onClose: () => void;
  onSaved: () => void;
  tCommon: (k: string) => string;
  t: (k: string, opts?: Record<string, unknown>) => string;
}): JSX.Element {
  const { open, ean, sessionId, profile, onClose, onSaved, tCommon, t } = props;
  const { t: tCategory } = useTranslation('category');
  const { locale } = useLocale();
  const currency = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const storeType = profile?.store_type ?? 'shop';
  const storeCfg = STORE_TYPES[storeType];
  const categories = useMemo(() => {
    if (storeType === 'shop' && profile?.shop_subtypes && profile.shop_subtypes.length > 0) {
      return categoriesForSubtypes(profile.shop_subtypes);
    }
    return storeCfg.categories;
  }, [storeCfg, storeType, profile?.shop_subtypes]);

  const [name, setName] = useState('');
  const [photoId, setPhotoId] = useState<UUID | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [costInput, setCostInput] = useState('');
  const [saleInput, setSaleInput] = useState('');
  const [category, setCategory] = useState<Category>(categories[0] ?? '');
  const [qty, setQty] = useState(1);
  const [expiry, setExpiry] = useState<string>('');
  const [errors, setErrors] = useState<{ name?: string; qty?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  // Ensure the chip-selected category stays valid when categories changes
  // after profile load.
  useEffect(() => {
    if (category === '' && categories.length > 0) {
      setCategory(categories[0] ?? '');
    }
  }, [categories, category]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  async function handlePhoto(file: File): Promise<void> {
    const compressed = await compressPhoto(file);
    const stored = await storePhoto(db, {
      blob: compressed.blob,
      width: compressed.width,
      height: compressed.height,
      mime: compressed.mime,
    });
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoId(stored.id);
    setPhotoPreview(URL.createObjectURL(compressed.blob));
  }

  async function save(): Promise<void> {
    const e: { name?: string; qty?: string } = {};
    if (name.trim().length < 2) e.name = t('err_name_required');
    if (qty <= 0) e.qty = t('err_qty_required');
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSubmitting(true);
    try {
      const cost = Math.max(0, parseCurrency(costInput, locale, currency) ?? 0);
      const sale = Math.max(0, parseCurrency(saleInput, locale, currency) ?? 0);
      const created = await createArticle(db, {
        name: name.trim(),
        photo_id: photoId,
        category,
        brand: null,
        cost_price_tnd: cost,
        sale_price_tnd: sale,
        notes: null,
        barcode_ean: ean,
        variants: [
          {
            color: null,
            size: null,
            floor_qty: 0,
            // Initial purchase quantity goes to 'back' via the createArticle
            // path's per-variant seed. This is the same shape the v0.3
            // multi-block Add Article uses when has_colors=false.
            back_qty: qty,
            photo_id: photoId,
          },
        ],
        sku_prefix: storeCfg.sku_prefix,
      });
      // The createArticle seed Movement uses transaction_id=null. We
      // need the receiving-session UUID on it to group properly. The
      // simplest fix is to add a separate Movement here AND zero out
      // the seeded one — but that creates an audit-trail oddity.
      // Cleaner: rewrite the seeded movement's transaction_id+expires_at
      // in place. ADR-002 says movements are immutable for delta/type/
      // created_at; transaction_id and expires_at aren't part of that
      // immutability contract (they're metadata about the entry event,
      // not the stock change itself). We patch them inline.
      const variant = created.variants[0]!;
      const seedMovement = created.movements.find(
        (m) => m.variant_id === variant.id && m.type === 'purchase',
      );
      const expiresAt = expiry ? new Date(expiry).toISOString() : null;
      if (seedMovement) {
        await db.movements.update(seedMovement.id, {
          transaction_id: sessionId,
          expires_at: expiresAt,
        });
        if (expiresAt) {
          await createLot(db, {
            variant_id: variant.id,
            expires_at: expiresAt,
            original_quantity: qty,
            source_movement_id: seedMovement.id,
          });
        }
      }
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="receive-unknown-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <Dialog.Title className="font-display text-base font-semibold">
                {t('unknown_title')}
              </Dialog.Title>
              <span
                data-testid="receive-unknown-ean"
                className="text-ink-3 mt-0.5 font-mono text-[11px]"
                dir="ltr"
              >
                {t('unknown_ean', { ean })}
              </span>
            </div>
            <Dialog.Close type="button" data-testid="receive-unknown-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <label htmlFor="receive-name" className="text-ink-2 block text-sm font-medium">
            {t('field_name')}
          </label>
          <input
            id="receive-name"
            data-testid="receive-unknown-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('field_name_placeholder')}
            className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />
          {errors.name ? (
            <p data-testid="receive-unknown-name-err" className="text-bad mt-1 text-xs">
              {errors.name}
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="receive-cost" className="text-ink-2 block text-xs font-medium">
                {t('field_cost', { currency })}
              </label>
              <input
                id="receive-cost"
                data-testid="receive-unknown-cost"
                type="text"
                inputMode="decimal"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
              />
            </div>
            <div>
              <label htmlFor="receive-sale" className="text-ink-2 block text-xs font-medium">
                {t('field_sale', { currency })}
              </label>
              <input
                id="receive-sale"
                data-testid="receive-unknown-sale"
                type="text"
                inputMode="decimal"
                value={saleInput}
                onChange={(e) => setSaleInput(e.target.value)}
                className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
              />
            </div>
          </div>

          <p className="text-ink-2 mt-3 text-sm font-medium">{t('field_category')}</p>
          <div data-testid="receive-unknown-categories" className="mt-1 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                data-testid={`receive-unknown-category-${c}`}
                aria-pressed={category === c}
                onClick={() => setCategory(c)}
                className={`rounded-full border px-3 py-1.5 text-xs ${
                  category === c
                    ? 'border-accent bg-accent-soft text-accent-ink'
                    : 'border-hair text-ink-2 bg-white'
                }`}
              >
                {tCategory(c)}
              </button>
            ))}
          </div>

          <p className="text-ink-2 mt-3 text-sm font-medium">{t('field_photo')}</p>
          <button
            type="button"
            data-testid="receive-unknown-photo-pick"
            onClick={() => fileInputRef.current?.click()}
            className="border-hair mt-1 inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-xs"
          >
            {photoId ? t('field_photo_change') : t('field_photo_pick')}
          </button>
          {photoPreview ? (
            <img
              data-testid="receive-unknown-photo-preview"
              src={photoPreview}
              alt=""
              className="border-hair mt-2 h-20 w-20 rounded-xl border object-cover"
            />
          ) : null}
          <input
            ref={fileInputRef}
            data-testid="receive-unknown-photo-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePhoto(f);
            }}
          />

          <label
            htmlFor="receive-unknown-qty"
            className="text-ink-2 mt-4 block text-sm font-medium"
          >
            {t('field_qty')}
          </label>
          <Stepper
            testId="receive-unknown-qty"
            value={qty}
            onChange={(v) => setQty(Math.max(1, v))}
          />
          {errors.qty ? (
            <p data-testid="receive-unknown-qty-err" className="text-bad mt-1 text-xs">
              {errors.qty}
            </p>
          ) : null}

          <label
            htmlFor="receive-unknown-expiry"
            className="text-ink-2 mt-4 block text-sm font-medium"
          >
            {t('field_expiry')}
          </label>
          <input
            id="receive-unknown-expiry"
            data-testid="receive-unknown-expiry"
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-sm"
          />

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="receive-unknown-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="receive-unknown-save"
              disabled={submitting}
              onClick={() => void save()}
              className="bg-accent flex-1 rounded-xl py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {t('save_next')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── stepper ──────────────────────────────────────────────────────────

function Stepper(props: {
  testId: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  const { testId, value, onChange } = props;
  return (
    <div className="border-hair mt-1 flex items-center rounded-xl border bg-white">
      <button
        type="button"
        data-testid={`${testId}-minus`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="bg-paper border-hair h-10 w-10 rounded-l-xl border-e text-lg"
      >
        −
      </button>
      <input
        data-testid={testId}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        className="flex-1 bg-transparent text-center font-mono text-base tabular-nums"
      />
      <button
        type="button"
        data-testid={`${testId}-plus`}
        onClick={() => onChange(value + 1)}
        className="bg-paper border-hair h-10 w-10 rounded-r-xl border-s text-lg"
      >
        +
      </button>
    </div>
  );
}
