import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { db } from '../db/db';
import { useProfile } from '../hooks/use-profile';
import { useLive } from '../hooks/use-live';
import { lotsExpiringWithin } from '../repos/lots';
import { expirySnoozeKey, getMeta, META_KEYS } from '../repos/meta';

const DEFAULT_THRESHOLD_DAYS = 7;

// v0.5 ADR-019: shop-only banner shown on Search when one or more lots
// are within the merchant-configured threshold (default 7 days). Honors
// per-variant snooze: tapping "Hide for 7 days" on /expiry stamps a
// meta key `expiry_snooze_${variantId}` with an ISO date through which
// the variant should be silenced. Snoozed variants are filtered out of
// the count so the banner stays clean. Non-shop verticals never render
// it (no lots ever exist).

export function ExpiryBanner(): JSX.Element | null {
  const { t } = useTranslation('expiry');
  const profile = useProfile();
  const isShop = profile?.store_type === 'shop';

  // Query unconditionally — useLive returns the seed value while the
  // profile resolves, so the count stays at 0 until we're sure the
  // store_type is shop.
  const expiringCount = useLive<number>(
    async () => {
      if (!isShop) return 0;
      const threshold =
        (await getMeta<number>(db, META_KEYS.expiry_threshold_days)) ?? DEFAULT_THRESHOLD_DAYS;
      const rows = await lotsExpiringWithin(db, threshold);
      const now = new Date().toISOString();
      let n = 0;
      for (const row of rows) {
        const snoozedUntil = await getMeta<string>(db, expirySnoozeKey(row.lot.variant_id));
        if (snoozedUntil && snoozedUntil > now) continue;
        n += 1;
      }
      return n;
    },
    [isShop],
    0,
  );

  if (!isShop) return null;
  if (expiringCount === 0) return null;
  return (
    <Link
      to="/expiry"
      data-testid="expiry-banner"
      className="bg-warn-soft border-warn mx-4 mt-2 inline-flex items-center justify-between gap-2 rounded-xl border p-3 text-start"
    >
      <span className="inline-flex items-center gap-2 text-sm">
        <TriangleAlert aria-hidden className="text-warn h-4 w-4" strokeWidth={2.25} />
        <span className="text-ink font-medium">{t('banner_count', { count: expiringCount })}</span>
      </span>
      <span className="text-ink-3 text-xs">{t('banner_cta')}</span>
    </Link>
  );
}
