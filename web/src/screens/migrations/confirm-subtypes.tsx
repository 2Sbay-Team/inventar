import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { ScreenLayout } from '../../components/screen-layout';
import { db } from '../../db/db';
import { useLive } from '../../hooks/use-live';
import { useProfile } from '../../hooks/use-profile';
import { getMeta, META_KEYS, setMeta } from '../../repos/meta';
import { upsertProfile } from '../../repos/profile';
import { SHOP_SUBTYPE_CONFIG, SHOP_SUBTYPE_ORDER } from '../../config/shop-subtypes';
import { FASHION_SUBTYPE_CONFIG, FASHION_SUBTYPE_ORDER } from '../../config/fashion-subtypes';

// v0.5.2 ADR-021 — one-time post-migration confirmation. The v8→v9
// upgrade derived fashion_subtypes / shop_subtypes from the legacy
// vertical (shoes → ['shoes']; clothes → ['clothing_men',
// 'clothing_women']; kiosk / grocery already mapped to shop in v6→v7).
// Those defaults are sensible but the merchant should confirm — a
// clothes shop that's mostly kids' clothing wants the kids subtype
// instead, etc. This screen lets them confirm or amend.
//
// Route guard: redirect to / if either (a) migration_v9_completed_at
// isn't set (no migration ran — there's nothing to confirm), or (b)
// migration_v9_subtypes_confirmed_at is set (already confirmed).

export function ConfirmSubtypesScreen(): JSX.Element | null {
  const { t } = useTranslation('migrations');
  const navigate = useNavigate();
  const profile = useProfile();
  // Use the no-initial-value overload so we can distinguish "loading"
  // (undefined) from "definitely not set" (null). Without that gap,
  // the screen flashes through completedAt=null on mount and triggers
  // the redirect before the live read resolves.
  const completedAt = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.migration_v9_completed_at)) ?? null,
    [],
  );
  const confirmedAt = useLive<string | null>(
    async () => (await getMeta<string>(db, META_KEYS.migration_v9_subtypes_confirmed_at)) ?? null,
    [],
  );

  // Local draft. Initialized from the profile values when the profile
  // resolves; subsequent edits stay in local state until Save commits.
  const [draft, setDraft] = useState<string[] | null>(null);
  useEffect(() => {
    if (!profile) return;
    if (draft !== null) return; // already initialised
    const initial =
      profile.store_type === 'fashion' ? profile.fashion_subtypes : profile.shop_subtypes;
    setDraft(initial);
  }, [profile, draft]);

  if (profile === undefined) return null;
  if (profile === null) return <Navigate to="/" replace />;
  // Wait for the live reads before deciding the guard. Without this
  // the screen briefly mounts with completedAt=undefined and the
  // !completedAt check below would fire a wrongful redirect.
  if (completedAt === undefined || confirmedAt === undefined) return null;
  // Guard: nothing to confirm OR already confirmed → redirect home.
  if (!completedAt) return <Navigate to="/" replace />;
  if (confirmedAt) return <Navigate to="/" replace />;

  const isFashion = profile.store_type === 'fashion';
  const order = isFashion ? FASHION_SUBTYPE_ORDER : SHOP_SUBTYPE_ORDER;
  const config = isFashion ? FASHION_SUBTYPE_CONFIG : SHOP_SUBTYPE_CONFIG;
  const ns = isFashion ? 'fashion_subtypes' : 'shop_subtypes';

  function toggle(st: string): void {
    setDraft((prev) =>
      prev ? (prev.includes(st) ? prev.filter((s) => s !== st) : [...prev, st]) : [st],
    );
  }

  async function save(): Promise<void> {
    if (!profile || !draft || draft.length === 0) return;
    await upsertProfile(db, {
      name: profile.name,
      locale: profile.locale,
      shop_subtypes: isFashion ? profile.shop_subtypes : draft,
      fashion_subtypes: isFashion ? draft : profile.fashion_subtypes,
    });
    await setMeta(db, META_KEYS.migration_v9_subtypes_confirmed_at, new Date().toISOString());
    navigate('/', { replace: true });
  }

  return (
    <ScreenLayout hideNav>
      <main
        data-testid="confirm-subtypes-screen"
        className="bg-paper mx-auto flex w-full flex-1 flex-col gap-5 px-6 py-12 min-[600px]:max-w-[540px]"
      >
        <header className="text-center">
          <h1 className="font-display text-ink text-2xl font-semibold tracking-tight">
            {t('title')}
          </h1>
          <p className="text-ink-2 mt-2 text-[14px] leading-relaxed">{t('subtitle')}</p>
        </header>

        <div className="space-y-2">
          {order.map((st) => {
            const cfg = (config as Record<string, { label_key: string; desc_key: string }>)[st];
            const active = draft?.includes(st) ?? false;
            return (
              <button
                key={st}
                type="button"
                data-testid={`confirm-subtype-${st}`}
                onClick={() => toggle(st)}
                aria-pressed={active}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start ${
                  active ? 'border-accent bg-accent-soft/40' : 'border-hair bg-white'
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${
                    active ? 'border-accent bg-accent text-white' : 'border-hair bg-white'
                  }`}
                >
                  {active ? '✓' : ''}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-ink text-sm font-semibold leading-tight">
                    {t(`${ns}:${cfg.label_key}`)}
                  </span>
                  <span className="text-ink-3 mt-0.5 text-[11px] leading-snug">
                    {t(`${ns}:${cfg.desc_key}`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-testid="confirm-subtypes-save"
          disabled={!draft || draft.length === 0}
          onClick={() => void save()}
          className="bg-accent w-full rounded-xl py-3 font-medium text-white disabled:opacity-50"
        >
          {t('save')}
        </button>
      </main>
    </ScreenLayout>
  );
}
