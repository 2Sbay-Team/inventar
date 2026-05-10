import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, EyeOff, TriangleAlert, XOctagon } from 'lucide-react';

import { ScreenLayout } from '../components/screen-layout';
import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { lotsExpiringWithin, softDeleteLot } from '../repos/lots';
import { recordMovement } from '../repos/movements';
import { expirySnoozeKey, getMeta, META_KEYS, setMeta } from '../repos/meta';
import { type Article, type Lot, type UUID, type Variant } from '../types';

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
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('week');
  const [now] = useState<Date>(() => new Date());
  const [busyVariantId, setBusyVariantId] = useState<UUID | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

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
  // batch they're holding.
  async function markDamaged(row: ExpiryRow): Promise<void> {
    setBusyVariantId(row.variant.id);
    try {
      if (row.remaining > 0) {
        await recordMovement(db, {
          variant_id: row.variant.id,
          delta: -row.remaining,
          type: 'damage',
          // Most expiring stock is on the floor; even if some is in the
          // back, picking 'floor' here keeps the audit consistent with
          // the "I can see it's gone bad" merchant action.
          location: 'floor',
          note: `expiry: ${row.earliestLot.expires_at.slice(0, 10)}`,
        });
      }
      await softDeleteLot(db, row.earliestLot.id);
    } finally {
      setBusyVariantId(null);
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
                    disabled
                    className="border-hair text-ink-3 cursor-not-allowed rounded-lg border bg-white px-3 py-1.5 text-xs"
                    title={t('discount_coming_soon') ?? ''}
                  >
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
      </main>
    </ScreenLayout>
  );
}
