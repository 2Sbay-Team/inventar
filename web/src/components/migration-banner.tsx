import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

import { db } from '../db/db';
import { useLive } from '../hooks/use-live';
import { useProfile } from '../hooks/use-profile';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';

// v0.5.2 ADR-021 — one-time post-migration banner. Shows on the home
// screen when the v8→v9 upgrade ran AND the merchant hasn't yet
// confirmed their subtypes. Tap navigates to the confirmation screen;
// "Hide for 7 days" suppresses the banner without confirming, so a
// merchant who's mid-checkout can deal with it later.
//
// Visibility logic:
//   completed     = migration_v9_completed_at IS SET
//   confirmed     = migration_v9_subtypes_confirmed_at IS SET
//   hiddenUntil   = migration_v9_banner_hidden_until (ISO string)
//   show iff completed AND NOT confirmed AND
//          (hiddenUntil IS NULL OR now() > hiddenUntil)

const HIDE_DAYS = 7;

export function MigrationBanner(): JSX.Element | null {
  const { t } = useTranslation('migrations');
  const profile = useProfile();
  const completed = useLive<boolean>(
    async () => Boolean(await getMeta<string>(db, META_KEYS.migration_v9_completed_at)),
    [],
    false,
  );
  const confirmed = useLive<boolean>(
    async () => Boolean(await getMeta<string>(db, META_KEYS.migration_v9_subtypes_confirmed_at)),
    [],
    false,
  );
  const hiddenUntil = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.migration_v9_banner_hidden_until)) ?? null,
    [],
    null,
  );

  if (!profile) return null;
  if (!completed || confirmed) return null;
  const now = new Date().toISOString();
  if (hiddenUntil && hiddenUntil > now) return null;

  async function hideForSevenDays(): Promise<void> {
    const until = new Date(Date.now() + HIDE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.migration_v9_banner_hidden_until, until);
  }

  return (
    <div
      data-testid="migration-banner"
      className="border-accent/30 bg-accent-soft/40 mx-3 mt-3 flex items-start gap-3 rounded-2xl border p-3"
    >
      <span className="bg-accent text-white flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full">
        <Sparkles aria-hidden className="h-4 w-4" strokeWidth={2} />
      </span>
      <div className="flex flex-1 flex-col">
        <Link
          data-testid="migration-banner-tap"
          to="/migrations/confirm-subtypes"
          className="text-ink text-sm font-medium leading-tight"
        >
          {t('banner_title')}
        </Link>
        <p className="text-ink-2 mt-0.5 text-[11px] leading-snug">{t('banner_body')}</p>
        <button
          type="button"
          data-testid="migration-banner-hide"
          onClick={() => void hideForSevenDays()}
          className="text-ink-3 mt-1 self-start text-[10.5px] font-medium underline"
        >
          {t('banner_hide_7d')}
        </button>
      </div>
    </div>
  );
}
