import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, EyeOff, Tag, TriangleAlert, Undo2, X, XOctagon } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useCurrency } from '../hooks/use-currency';
import { useLive } from '../hooks/use-live';
import { useLocale } from '../hooks/use-locale';
import { updateArticle } from '../repos/articles';
import { lotsExpiringWithin, softDeleteLot, undeleteLot } from '../repos/lots';
import { recordMovement, revertMovement } from '../repos/movements';
import { expirySnoozeKey, getMeta, META_KEYS, setMeta } from '../repos/meta';
import { formatCurrency } from '../i18n/format-currency';
import { parseCurrency } from '../i18n/parse-currency';
import { type Article, type Locale, type Lot, type UUID, type Variant } from '../types';

// Undo window for damage actions. Long enough for the merchant to
// realise they tapped wrong, short enough that the toast doesn't
// linger forever.
const DAMAGE_UNDO_WINDOW_MS = 6000;

interface PendingDamage {
  lotId: UUID;
  movementId: UUID | null; // null when remaining was 0 — no movement was written
  articleName: string;
  expiresAt: string;
}

const DEFAULT_THRESHOLD_DAYS = 7;
const DEFAULT_SNOOZE_DAYS = 7;
// Window for "all upcoming" filter — covers the case where the merchant
// wants to scan beyond the alert threshold to plan ahead.
const ALL_UPCOMING_WINDOW_DAYS = 365;

type FilterKey = 'today' | 'week' | 'month' | 'all';

interface ExpiryRow {
  variant: Variant;
  article: Article;
  // The earliest-expiring alive lot for this variant (FIFO order).
  earliestLot: Lot;
  // Sum of remaining for all lots of this variant that fell within the
  // active filter window. Lots beyond the window aren't counted.
  remaining: number;
  // Days until earliest lot expiry; negative for already-expired.
  daysUntilExpiry: number;
  // Whether the merchant has snoozed this variant beyond now. We still
  // surface the row so the merchant can manage it; just dimmed and
  // marked snoozed.
  snoozed: boolean;
}

async function loadRows(filter: FilterKey, now: Date): Promise<ExpiryRow[]> {
  const windowDays =
    filter === 'today'
      ? 1
      : filter === 'week'
        ? 7
        : filter === 'month'
          ? 31
          : ALL_UPCOMING_WINDOW_DAYS;
  const within = await lotsExpiringWithin(db, windowDays, now);
  if (within.length === 0) return [];

  // Group by variant_id; track the earliest lot, total remaining for
  // the variant within the window, and whether the variant is snoozed.
  const byVariant = new Map<UUID, { lots: typeof within; earliest: (typeof within)[number] }>();
  for (const row of within) {
    const variantId = row.lot.variant_id;
    const cur = byVariant.get(variantId);
    if (!cur) {
      byVariant.set(variantId, { lots: [row], earliest: row });
    } else {
      cur.lots.push(row);
      if (row.lot.expires_at < cur.earliest.lot.expires_at) cur.earliest = row;
    }
  }

  const nowIso = now.toISOString();
  const rows: ExpiryRow[] = [];
  for (const { lots, earliest } of byVariant.values()) {
    const variant = await db.variants.get(earliest.lot.variant_id);
    if (!variant || variant.deleted_at !== null) continue;
    const article = await db.articles.get(variant.article_id);
    if (!article || article.deleted_at !== null) continue;
    const snoozedUntil = await getMeta<string>(db, expirySnoozeKey(variant.id));
    const snoozed = !!snoozedUntil && snoozedUntil > nowIso;
    rows.push({
      variant,
      article,
      earliestLot: earliest.lot,
      remaining: lots.reduce((s, l) => s + l.remaining, 0),
      daysUntilExpiry: earliest.daysUntilExpiry,
      snoozed,
    });
  }
  rows.sort((a, b) => (a.earliestLot.expires_at < b.earliestLot.expires_at ? -1 : 1));
  return rows;
}

export function ExpiryScreen(): JSX.Element {
  const { t } = useTranslation('expiry');
  const { t: tCommon } = useTranslation('common');
  const { locale } = useLocale();
  const currency = useCurrency();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('week');
  const [now] = useState<Date>(() => new Date());
  const [busyVariantId, setBusyVariantId] = useState<UUID | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // v0.5 commit-9 (gap fix): Discount sub-sheet. The brief listed the
  // button without defining semantics; lightest reasonable
  // interpretation is "lower the article's catalogue sale price to
  // move stock fast" — does NOT touch the lot or write a movement,
  // just persists a new sale_price_tnd via updateArticle.
  const [discountTarget, setDiscountTarget] = useState<ExpiryRow | null>(null);

  // v0.5.1: damage undo. Mark-damaged is destructive (writes a damage
  // Movement + softDeleteLot) and the merchant has no other recovery
  // path. We surface a 6-second toast with an Undo button that
  // reverses both writes.
  const [pendingDamage, setPendingDamage] = useState<PendingDamage | null>(null);
  useEffect(() => {
    if (!pendingDamage) return;
    const handle = window.setTimeout(() => {
      setPendingDamage(null);
    }, DAMAGE_UNDO_WINDOW_MS);
    return () => window.clearTimeout(handle);
  }, [pendingDamage]);

  const rows = useLive<ExpiryRow[]>(() => loadRows(filter, now), [filter, now, refreshTick], []);

  const threshold = useLive<number>(
    async () =>
      (await getMeta<number>(db, META_KEYS.expiry_threshold_days)) ?? DEFAULT_THRESHOLD_DAYS,
    [refreshTick],
    DEFAULT_THRESHOLD_DAYS,
  );

  // Snooze a variant for N days. Refresh the list after.
  async function hideForSevenDays(variantId: UUID): Promise<void> {
    setBusyVariantId(variantId);
    try {
      const until = new Date(
        now.getTime() + DEFAULT_SNOOZE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      await setMeta(db, expirySnoozeKey(variantId), until);
    } finally {
      setBusyVariantId(null);
      setRefreshTick((n) => n + 1);
    }
  }

  // Mark damaged: write a damage Movement for the earliest-expiring
  // lot's full remaining quantity, then soft-delete that lot. The
  // variant's other lots (if any) keep their FIFO position. We don't
  // mass-damage every lot of the variant — only the earliest one,
  // because the merchant likely confirmed the damage on a specific
  // batch they're holding. v0.5.1: capture the action so the
  // 6-second Undo toast can reverse it.
  async function markDamaged(row: ExpiryRow): Promise<void> {
    setBusyVariantId(row.variant.id);
    try {
      let damageMovementId: UUID | null = null;
      if (row.remaining > 0) {
        const m = await recordMovement(db, {
          variant_id: row.variant.id,
          delta: -row.remaining,
          type: 'damage',
          // Most expiring stock is on the floor; even if some is in the
          // back, picking 'floor' here keeps the audit consistent with
          // the "I can see it's gone bad" merchant action.
          location: 'floor',
          note: `expiry: ${row.earliestLot.expires_at.slice(0, 10)}`,
        });
        damageMovementId = m.id;
      }
      await softDeleteLot(db, row.earliestLot.id);
      setPendingDamage({
        lotId: row.earliestLot.id,
        movementId: damageMovementId,
        articleName: row.article.name,
        expiresAt: row.earliestLot.expires_at,
      });
    } finally {
      setBusyVariantId(null);
      setRefreshTick((n) => n + 1);
    }
  }

  async function undoDamage(): Promise<void> {
    if (!pendingDamage) return;
    const snap = pendingDamage;
    setPendingDamage(null);
    try {
      if (snap.movementId) await revertMovement(db, snap.movementId);
      await undeleteLot(db, snap.lotId);
    } finally {
      setRefreshTick((n) => n + 1);
    }
  }

  const filterKeys = useMemo<FilterKey[]>(() => ['today', 'week', 'month', 'all'], []);

  return (
    <ScreenLayout hideNav>
      <header className="border-hair grid grid-cols-3 items-center border-b bg-white px-4 py-3">
        <button
          type="button"
          data-testid="expiry-back"
          onClick={() => navigate(-1)}
          className="text-ink-3 inline-flex items-center gap-1 justify-self-start text-xs font-medium"
        >
          <ArrowLeft aria-hidden className="h-4 w-4 rtl:rotate-180" strokeWidth={2.25} />
          {t('back')}
        </button>
        <h3 className="font-display inline-flex items-center justify-center gap-1.5 justify-self-center text-sm font-semibold tracking-tight">
          <TriangleAlert aria-hidden className="text-warn h-4 w-4" strokeWidth={2.25} />
          {t('title')}
        </h3>
        <span
          data-testid="expiry-threshold-display"
          className="text-ink-3 justify-self-end font-mono text-[11px]"
          dir="ltr"
        >
          {t('threshold_chip', { n: threshold })}
        </span>
      </header>

      <main
        data-testid="expiry-screen"
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
      >
        <div
          data-testid="expiry-filter"
          className="border-hair flex rounded-xl border bg-white p-1"
        >
          {filterKeys.map((k) => (
            <button
              key={k}
              type="button"
              data-testid={`expiry-filter-${k}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
              className={`flex-1 rounded-lg py-1.5 text-xs ${filter === k ? 'bg-ink text-white' : 'text-ink-2'}`}
            >
              {t(`filter_${k}`)}
            </button>
          ))}
        </div>

        <DiscountSheet
          target={discountTarget}
          onClose={() => setDiscountTarget(null)}
          onSaved={() => {
            setDiscountTarget(null);
            setRefreshTick((n) => n + 1);
          }}
          t={t}
          tCommon={tCommon}
          locale={locale}
          currency={currency}
        />

        {rows.length === 0 ? (
          <p data-testid="expiry-empty" className="text-ink-3 mt-12 text-center text-sm">
            {t('empty')}
          </p>
        ) : (
          <ul data-testid="expiry-rows" className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.variant.id}
                data-testid={`expiry-row-${row.article.internal_code}`}
                className={`border-hair rounded-xl border bg-white p-3 ${row.snoozed ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/article/${row.article.id}`} className="flex flex-1 flex-col">
                    <div className="text-ink text-sm font-medium">{row.article.name}</div>
                    <div className="text-ink-3 mt-0.5 font-mono text-[11px]" dir="ltr">
                      {row.article.internal_code} · {t('remaining', { n: row.remaining })}
                    </div>
                  </Link>
                  <span
                    data-testid={`expiry-row-${row.article.internal_code}-days`}
                    className={`shrink-0 rounded-lg px-2 py-1 font-mono text-[11px] ${
                      row.daysUntilExpiry < 0
                        ? 'bg-bad/10 text-bad'
                        : row.daysUntilExpiry <= threshold
                          ? 'bg-warn-soft text-warn'
                          : 'bg-paper-deep text-ink-3'
                    }`}
                    dir="ltr"
                  >
                    {row.daysUntilExpiry < 0
                      ? t('days_expired', { n: -row.daysUntilExpiry })
                      : t('days_remaining', { n: row.daysUntilExpiry })}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid={`expiry-row-${row.article.internal_code}-discount`}
                    disabled={busyVariantId === row.variant.id}
                    onClick={() => setDiscountTarget(row)}
                    className="border-accent/40 text-accent inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    <Tag aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
                    {t('action_discount')}
                  </button>
                  <button
                    type="button"
                    data-testid={`expiry-row-${row.article.internal_code}-damage`}
                    disabled={busyVariantId === row.variant.id}
                    onClick={() => void markDamaged(row)}
                    className="text-bad border-bad/30 inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    <XOctagon aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
                    {t('action_damaged')}
                  </button>
                  <button
                    type="button"
                    data-testid={`expiry-row-${row.article.internal_code}-snooze`}
                    disabled={busyVariantId === row.variant.id}
                    onClick={() => void hideForSevenDays(row.variant.id)}
                    className="border-hair text-ink-2 inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    <EyeOff aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
                    {t('action_snooze')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {pendingDamage ? (
          <div
            data-testid="expiry-damage-undo"
            className="bg-ink fixed bottom-5 left-3 right-3 z-50 inline-flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm text-white shadow-xl"
            role="status"
          >
            <span className="truncate">
              {t('damage_undo_msg', { name: pendingDamage.articleName })}
            </span>
            <button
              type="button"
              data-testid="expiry-damage-undo-btn"
              onClick={() => void undoDamage()}
              className="bg-accent inline-flex shrink-0 items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-medium"
            >
              <Undo2 aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />
              {t('damage_undo_action')}
            </button>
          </div>
        ) : null}
      </main>
    </ScreenLayout>
  );
}

// ─── discount sub-sheet ───────────────────────────────────────────────

function DiscountSheet(props: {
  target: ExpiryRow | null;
  onClose: () => void;
  onSaved: () => void;
  t: (k: string, opts?: Record<string, unknown>) => string;
  tCommon: (k: string) => string;
  locale: Locale;
  currency: string;
}): JSX.Element | null {
  const { target, onClose, onSaved, t, tCommon, locale, currency } = props;
  const [draftInput, setDraftInput] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Reset the draft each time a new target row is opened. We can't put
  // this in a useEffect-on-target because the input remounts on each
  // open via Dialog's conditional render, and the useState initializer
  // runs once; switching targets would otherwise show stale text.
  const targetId = target?.article.id ?? null;
  const [lastTargetId, setLastTargetId] = useState<UUID | null>(null);
  if (targetId !== lastTargetId) {
    setLastTargetId(targetId);
    setDraftInput('');
  }

  if (!target) return null;

  const currentSale = target.article.sale_price_tnd;

  async function save(): Promise<void> {
    if (!target) return;
    const parsed = parseCurrency(draftInput, locale, currency);
    if (parsed === null || parsed <= 0) return;
    setSubmitting(true);
    try {
      await updateArticle(db, target.article.id, { sale_price_tnd: parsed });
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={true} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content
          data-testid="expiry-discount-sheet"
          className="bg-paper fixed inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl p-5 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex flex-col">
              <Dialog.Title className="font-display text-base font-semibold">
                {t('discount_title', { name: target.article.name })}
              </Dialog.Title>
              <span className="text-ink-3 mt-0.5 text-xs">
                {t('discount_current', { price: formatCurrency(currentSale, locale, currency) })}
              </span>
            </div>
            <Dialog.Close type="button" data-testid="expiry-discount-close" className="text-ink-3">
              <X aria-hidden className="h-5 w-5" strokeWidth={2} />
            </Dialog.Close>
          </div>

          <p className="text-ink-2 text-xs leading-relaxed">{t('discount_hint')}</p>

          <label
            htmlFor="expiry-discount-input"
            className="text-ink-2 mt-3 block text-sm font-medium"
          >
            {t('discount_new_price', { currency })}
          </label>
          <input
            id="expiry-discount-input"
            data-testid="expiry-discount-input"
            type="text"
            inputMode="decimal"
            autoFocus
            value={draftInput}
            onChange={(e) => setDraftInput(e.target.value)}
            placeholder={formatCurrency(Math.floor(currentSale * 0.7), locale, currency)}
            className="border-hair mt-1 w-full rounded-xl border bg-white px-3 py-2.5 text-end font-mono text-sm font-semibold"
          />

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="expiry-discount-cancel"
              onClick={onClose}
              className="border-hair flex-1 rounded-xl border bg-white py-2.5 text-sm"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="expiry-discount-save"
              disabled={submitting || draftInput.trim() === ''}
              onClick={() => void save()}
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
