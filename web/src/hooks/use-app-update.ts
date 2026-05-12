import { useCallback, useEffect, useState } from 'react';
import { db } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';
import { getSwHandle } from '../pwa/register-sw';
import { fetchWhatsNew, type RiskLevel, type WhatsNew } from '../pwa/fetch-whats-new';

// v0.6 ADR-031 — orchestrates the update-consent modal.
//
// Lifecycle:
//   idle       — no waiting SW, or waiting SW snoozed/skipped
//   loading    — waiting SW detected; fetching whats-new.json
//   prompting  — modal visible (whats-new resolved OR fallback path)
//   installing — merchant tapped Install; SW activating + page reloading
//
// Per the brief, the modal is fully blocking — the merchant must pick
// one of the three options. The hook exposes status + actions; the
// consumer (AppUpdateModal) renders Radix Dialog around them.
//
// v0.6.2 ADR-032 — risk-aware variant. The hook surfaces the
// normalized risk_level + migration metadata for the consumer to
// render warning/breaking branches. Two consent-gate rules change:
//
//   • Snooze key is composite (version, risk_level). When the same
//     version's whats-new.json is republished at a higher risk level
//     (safe → migration), the mismatch invalidates the snooze and the
//     modal re-prompts on the next probe.
//   • Breaking updates ALWAYS prompt — they bypass both snooze and
//     skipped-versions. The brief calls this "force consideration":
//     a merchant cannot suppress a non-rollback-able update.

export type UpdateStatus = 'idle' | 'loading' | 'prompting' | 'installing';

const SNOOZE_MS = 24 * 60 * 60 * 1000;
// Sentinel used when whats-new.json failed to load. Snoozing or
// skipping under this key still works — the merchant doesn't get
// stuck in a re-prompt loop because the network is briefly flaky.
export const SKIP_SENTINEL_UNKNOWN = '__unknown__';

export interface AppUpdate {
  status: UpdateStatus;
  whatsNew: WhatsNew | null;
  promptVersion: string | null;
  // Surfaced separately so the modal can branch even on the
  // fallback path where whatsNew is null (always 'safe' there).
  riskLevel: RiskLevel;
  installNow(): Promise<void>;
  snooze(): Promise<void>;
  skip(): Promise<void>;
}

// ── Pure async helpers (exported for unit tests) ────────────────────

export async function shouldPromptForUpdate(
  version: string,
  riskLevel: RiskLevel,
): Promise<boolean> {
  // Breaking updates bypass snooze + skip — the merchant must see the
  // warning every probe until they install or downgrade. This is the
  // "force consideration" rule from ADR-032.
  if (riskLevel === 'breaking') return true;

  const skipped = (await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions)) ?? [];
  if (skipped.includes(version)) return false;

  const snoozeUntil = await getMeta<string>(db, META_KEYS.update_snooze_until);
  const snoozedVersion = await getMeta<string>(db, META_KEYS.update_snoozed_version);
  const snoozedRiskLevel = await getMeta<string>(db, META_KEYS.update_snoozed_risk_level);
  // The snooze only suppresses when ALL THREE match: version, risk
  // level, and active window. A risk-level mismatch (e.g. snoozed at
  // 'safe', the same version republished as 'migration') means the
  // merchant hasn't yet consented to the heavier warning — re-prompt.
  if (
    snoozeUntil &&
    snoozedVersion === version &&
    snoozedRiskLevel === riskLevel &&
    new Date().toISOString() < snoozeUntil
  ) {
    return false;
  }
  return true;
}

export async function recordUpdateSnoozed(
  version: string,
  riskLevel: RiskLevel,
  nowMs: number = Date.now(),
): Promise<void> {
  const until = new Date(nowMs + SNOOZE_MS).toISOString();
  await setMeta(db, META_KEYS.update_snoozed_version, version);
  await setMeta(db, META_KEYS.update_snoozed_risk_level, riskLevel);
  await setMeta(db, META_KEYS.update_snooze_until, until);
}

export async function recordUpdateSkipped(version: string): Promise<void> {
  const existing = (await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions)) ?? [];
  if (!existing.includes(version)) {
    await setMeta(db, META_KEYS.update_skipped_versions, [...existing, version]);
  }
}

export async function recordUpdateJustInstalled(version: string): Promise<void> {
  if (version.trim() === '') return;
  await setMeta(db, META_KEYS.update_just_installed, version);
}

// ── Hook ────────────────────────────────────────────────────────────

export function useAppUpdate(): AppUpdate {
  const [status, setStatus] = useState<UpdateStatus>('idle');
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null);
  const [promptVersion, setPromptVersion] = useState<string | null>(null);
  // Mirrored from whatsNew?.risk_level so the modal and the snooze
  // callback can read it without re-deriving on every render.
  // Defaults to 'safe' on the fallback path so the snooze/skip
  // affordances remain available there.
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('safe');

  const handleWaiting = useCallback(async () => {
    setStatus('loading');
    const fetched = await fetchWhatsNew();
    const version = fetched?.version ?? SKIP_SENTINEL_UNKNOWN;
    const risk: RiskLevel = fetched?.risk_level ?? 'safe';
    if (!(await shouldPromptForUpdate(version, risk))) {
      setStatus('idle');
      return;
    }
    setWhatsNew(fetched);
    setPromptVersion(fetched?.version ?? null);
    setRiskLevel(risk);
    setStatus('prompting');
  }, []);

  useEffect(() => {
    const handle = getSwHandle();
    const off = handle.on('waiting', () => {
      void handleWaiting();
    });
    // Some browsers may have fired 'waiting' before this effect
    // mounted (workbox-window dispatches once per registration).
    // Probe the registration directly to recover from that race.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      void (async () => {
        const reg = await navigator.serviceWorker.getRegistration('/');
        if (reg?.waiting) void handleWaiting();
      })();
    }
    return off;
  }, [handleWaiting]);

  const installNow = useCallback(async () => {
    const handle = getSwHandle();
    setStatus('installing');
    const versionForToast = promptVersion ?? '';
    await recordUpdateJustInstalled(versionForToast);
    try {
      await handle.activateWaiting();
    } catch (err) {
      console.error('[use-app-update] activateWaiting failed', err);
      if (versionForToast !== '') {
        await setMeta(db, META_KEYS.update_just_installed, '');
      }
      setStatus('prompting');
      return;
    }
    window.location.reload();
  }, [promptVersion]);

  const snooze = useCallback(async () => {
    const version = promptVersion ?? SKIP_SENTINEL_UNKNOWN;
    await recordUpdateSnoozed(version, riskLevel);
    setStatus('idle');
    setWhatsNew(null);
    setPromptVersion(null);
    setRiskLevel('safe');
  }, [promptVersion, riskLevel]);

  const skip = useCallback(async () => {
    const version = promptVersion ?? SKIP_SENTINEL_UNKNOWN;
    await recordUpdateSkipped(version);
    setStatus('idle');
    setWhatsNew(null);
    setPromptVersion(null);
    setRiskLevel('safe');
  }, [promptVersion]);

  return { status, whatsNew, promptVersion, riskLevel, installNow, snooze, skip };
}
