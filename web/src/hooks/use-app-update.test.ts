import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, DB_NAME } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../repos/meta';
import {
  recordUpdateJustInstalled,
  recordUpdateSkipped,
  recordUpdateSnoozed,
  shouldPromptForUpdate,
  SKIP_SENTINEL_UNKNOWN,
} from './use-app-update';

// v0.6 ADR-031 — unit tests for the deterministic update-consent
// helpers. The full hook (useAppUpdate) is covered as an integration
// concern in the e2e specs; these tests pin the IDB-state contract:
//
//   • shouldPromptForUpdate honours snooze + skip
//   • recordUpdateSnoozed writes a 24 h window with the version pinned
//   • recordUpdateSkipped appends without duplicates
//   • recordUpdateJustInstalled records the about-to-be-active version

const VERSION_A = '0.6.0';
const VERSION_B = '0.7.0';

beforeEach(async () => {
  if (db.isOpen()) db.close();
  await indexedDB.deleteDatabase(DB_NAME);
  await db.open();
});

afterEach(async () => {
  db.close();
  await indexedDB.deleteDatabase(DB_NAME);
});

describe('shouldPromptForUpdate', () => {
  it('returns true on a fresh state (no snooze, no skip)', async () => {
    expect(await shouldPromptForUpdate(VERSION_A, 'safe')).toBe(true);
  });

  it('returns false when the version is in the skipped list (safe + migration honour skip)', async () => {
    await setMeta(db, META_KEYS.update_skipped_versions, [VERSION_A]);
    expect(await shouldPromptForUpdate(VERSION_A, 'safe')).toBe(false);
    expect(await shouldPromptForUpdate(VERSION_A, 'migration')).toBe(false);
    // A different version is still promptable.
    expect(await shouldPromptForUpdate(VERSION_B, 'safe')).toBe(true);
  });

  it('returns false while snooze is active for the same (version, risk_level)', async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.update_snoozed_version, VERSION_A);
    await setMeta(db, META_KEYS.update_snoozed_risk_level, 'safe');
    await setMeta(db, META_KEYS.update_snooze_until, farFuture);
    expect(await shouldPromptForUpdate(VERSION_A, 'safe')).toBe(false);
  });

  it('returns true after the snooze window has elapsed', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.update_snoozed_version, VERSION_A);
    await setMeta(db, META_KEYS.update_snoozed_risk_level, 'safe');
    await setMeta(db, META_KEYS.update_snooze_until, past);
    expect(await shouldPromptForUpdate(VERSION_A, 'safe')).toBe(true);
  });

  it('returns true for a NEW version even when a different version is currently snoozed', async () => {
    // Merchant snoozed v0.6.0; v0.7.0 has now landed in waiting → they
    // should be re-prompted because the snooze is per-version, not
    // permanent.
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.update_snoozed_version, VERSION_A);
    await setMeta(db, META_KEYS.update_snoozed_risk_level, 'safe');
    await setMeta(db, META_KEYS.update_snooze_until, farFuture);
    expect(await shouldPromptForUpdate(VERSION_B, 'safe')).toBe(true);
  });

  // ── v0.6.2 risk-level rules ─────────────────────────────────────

  it('returns true when the SAME version is republished at a HIGHER risk level (snooze invalidated)', async () => {
    // Merchant snoozed v0.6.0 when it was 'safe'; the same version is
    // republished as 'migration' (e.g. a hotfix discovered a schema
    // bump is needed). The risk_level mismatch must override the
    // still-active snooze window.
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.update_snoozed_version, VERSION_A);
    await setMeta(db, META_KEYS.update_snoozed_risk_level, 'safe');
    await setMeta(db, META_KEYS.update_snooze_until, farFuture);
    expect(await shouldPromptForUpdate(VERSION_A, 'migration')).toBe(true);
  });

  it("'breaking' updates bypass the skipped-versions list", async () => {
    // The "force consideration" rule: a merchant cannot suppress a
    // non-rollback-able update by clicking Skip on an earlier risk
    // level. Tested by stuffing the version into skipped (the only
    // way that list can have a 'breaking' entry today since the
    // breaking modal hides the Skip button — but defence-in-depth).
    await setMeta(db, META_KEYS.update_skipped_versions, [VERSION_A]);
    expect(await shouldPromptForUpdate(VERSION_A, 'breaking')).toBe(true);
  });

  it("'breaking' updates bypass an active snooze", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await setMeta(db, META_KEYS.update_snoozed_version, VERSION_A);
    await setMeta(db, META_KEYS.update_snoozed_risk_level, 'breaking');
    await setMeta(db, META_KEYS.update_snooze_until, farFuture);
    expect(await shouldPromptForUpdate(VERSION_A, 'breaking')).toBe(true);
  });
});

describe('recordUpdateSnoozed', () => {
  it('writes version + risk_level + a 24 h future timestamp', async () => {
    const now = Date.parse('2026-06-01T10:00:00.000Z');
    await recordUpdateSnoozed(VERSION_A, 'migration', now);
    expect(await getMeta<string>(db, META_KEYS.update_snoozed_version)).toBe(VERSION_A);
    expect(await getMeta<string>(db, META_KEYS.update_snoozed_risk_level)).toBe('migration');
    const until = await getMeta<string>(db, META_KEYS.update_snooze_until);
    expect(until).toBe('2026-06-02T10:00:00.000Z');
  });

  it('overwrites a prior snooze (newer wins, all three fields)', async () => {
    await recordUpdateSnoozed(VERSION_A, 'safe', Date.parse('2026-06-01T10:00:00.000Z'));
    await recordUpdateSnoozed(VERSION_B, 'migration', Date.parse('2026-06-05T10:00:00.000Z'));
    expect(await getMeta<string>(db, META_KEYS.update_snoozed_version)).toBe(VERSION_B);
    expect(await getMeta<string>(db, META_KEYS.update_snoozed_risk_level)).toBe('migration');
    expect(await getMeta<string>(db, META_KEYS.update_snooze_until)).toBe(
      '2026-06-06T10:00:00.000Z',
    );
  });
});

describe('recordUpdateSkipped', () => {
  it('appends a version to an empty skipped list', async () => {
    await recordUpdateSkipped(VERSION_A);
    expect(await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions)).toEqual([
      VERSION_A,
    ]);
  });

  it('appends without duplicating when called twice for the same version', async () => {
    await recordUpdateSkipped(VERSION_A);
    await recordUpdateSkipped(VERSION_A);
    expect(await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions)).toEqual([
      VERSION_A,
    ]);
  });

  it('preserves existing entries when adding a new one', async () => {
    await recordUpdateSkipped(VERSION_A);
    await recordUpdateSkipped(VERSION_B);
    const list = await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions);
    expect(list).toEqual([VERSION_A, VERSION_B]);
  });

  it('accepts the unknown-version sentinel (fallback-modal path)', async () => {
    await recordUpdateSkipped(SKIP_SENTINEL_UNKNOWN);
    const list = await getMeta<readonly string[]>(db, META_KEYS.update_skipped_versions);
    expect(list).toEqual([SKIP_SENTINEL_UNKNOWN]);
    // And the gate uses the same sentinel on the next probe.
    // The fallback path always carries risk_level='safe' (no payload
    // means no warning to display, so we default to the lightest UX).
    expect(await shouldPromptForUpdate(SKIP_SENTINEL_UNKNOWN, 'safe')).toBe(false);
  });
});

describe('recordUpdateJustInstalled', () => {
  it('writes the version meta so the post-reload toast can fire', async () => {
    await recordUpdateJustInstalled(VERSION_A);
    expect(await getMeta<string>(db, META_KEYS.update_just_installed)).toBe(VERSION_A);
  });

  it('no-ops on an empty version (whats-new failed to load case)', async () => {
    await recordUpdateJustInstalled('');
    expect(await getMeta<string>(db, META_KEYS.update_just_installed)).toBeUndefined();
  });
});
