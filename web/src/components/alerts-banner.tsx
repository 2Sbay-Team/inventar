import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';

import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { lotsExpiringWithin } from '../repos/lots';
import { expirySnoozeKey, getMeta, META_KEYS, setMeta } from '../repos/meta';
import { quantityFor } from '../repos/quantity';

// v0.5.2 ADR-018 — consolidated alerts banner. Replaces ExpiryBanner on
// Search by aggregating BOTH low-stock and expiring counts. Tap →
// /alerts. "Hide for 7 days" stores both the hidden_until timestamp AND
// a snapshot of the alert count, so a new alert arriving mid-
// suppression (count > snapshot) re-surfaces the banner immediately.

const HIDE_DAYS = 7;
const DEFAULT_EXPIRY_THRESHOLD_DAYS = 7;

interface AlertCount {
  low: number;
  expiring: number;
  total: number;
}

async function computeAlertCount(): Promise<AlertCount> {
  // Low-stock: articles with min_stock_threshold AND total stock below.
  const articles = (await db.articles.toArray()).filter(
    (a) => a.deleted_at === null && a.archived_at === null && a.min_stock_threshold != null,
  );
  let low = 0;
  for (const a of articles) {
    const variants = (await db.variants.where('article_id').equals(a.id).toArray()).filter(
      (v) => v.deleted_at === null,
    );
    let total = 0;
    for (const v of variants) total += await quantityFor(db, v.id);
    if (total < (a.min_stock_threshold ?? 0)) low += 1;
  }
  // Expiring: lots within global threshold AND not snoozed per-variant.
  // Mirrors the dashboard widget so the count agrees.
  const threshold =
    (await getMeta<number>(db, META_KEYS.expiry_threshold_days)) ?? DEFAULT_EXPIRY_THRESHOLD_DAYS;
  const lots = await lotsExpiringWithin(db, threshold);
  let expiring = 0;
  const nowIso = new Date().toISOString();
  for (const row of lots) {
    const snoozedUntil = await getMeta<string>(db, expirySnoozeKey(row.lot.variant_id));
    if (snoozedUntil && snoozedUntil > nowIso) continue;
    expiring += 1;
  }
  return { low, expiring, total: low + expiring };
}

export function AlertsBanner(): JSX.Element | null {
  const { t } = useTranslation('alerts');
  const profile = useProfile();
  const count = useLive<AlertCount>(computeAlertCount, [], { low: 0, expiring: 0, total: 0 });
  // hiddenUntil + snapshot decide visibility together with current count.
  const hiddenUntil = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.alerts_banner_hidden_until)) ?? null,
    [],
    null,
  );
  const snapshot = useLive<number>(
    async () => (await getMeta<number>(db, META_KEYS.alerts_banner_hidden_count_snapshot)) ?? 0,
    [],
    0,
  );

  if (!profile) return null;
  if (count.total === 0) return null;
  // Suppressed if hidden_until is in the future AND current count
  // hasn't grown beyond the snapshot. New alerts arriving mid-
  // suppression bump the count past the snapshot → banner reappears.
  const now = new Date().toISOString();
  if (hiddenUntil && hiddenUntil > now && count.total <= snapshot) return null;

  async function hideForSevenDays(): Promise<void> {
    const until = new Date(Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.alerts_banner_hidden_until, until);
    await setMeta(db, META_KEYS.alerts_banner_hidden_count_snapshot, count.total);
  }

  return (
    <div
      data-testid="alerts-banner"
      className="border-warn/40 bg-warn-soft/40 mx-3 mt-3 flex items-start gap-3 rounded-2xl border p-3"
    >
      <span className="bg-warn text-white flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full">
        <Bell aria-hidden className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="flex flex-1 flex-col">
        <Link
          data-testid="alerts-banner-tap"
          to="/alerts"
          className="text-ink text-sm font-medium leading-tight"
        >
          {t('banner_count', { n: count.total })}
        </Link>
        <p className="text-ink-2 mt-0.5 text-[11px] leading-snug">
          {t('banner_breakdown', { low: count.low, expiring: count.expiring })}
        </p>
        <button
          type="button"
          data-testid="alerts-banner-hide"
          onClick={() => void hideForSevenDays()}
          className="text-ink-3 mt-1 self-start text-[10.5px] font-medium underline"
        >
          {t('banner_hide_7d')}
        </button>
      </div>
    </div>
  );
}
