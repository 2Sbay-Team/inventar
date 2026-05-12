# Inventar — Runbook

Operational notes for the maintainer. Day-to-day commands, recovery procedures, and "what to do when X happens" for v0.5.2 onwards.

---

## 1. Deploys

### Standard deploy

```bash
cd /opt/inventar
./scripts/deploy.sh
```

The script:
1. `docker compose build inventar_web` (multi-stage: Vite build → nginx)
2. `docker compose up -d --force-recreate`
3. Polls health for ≤60s; prints recent logs on unhealthy.

A successful run ends with `==> healthy`. The new bundle is live on `https://inventar.hoodhood.ai/`.

### Quick smoke after deploy

```bash
# 1. Shell mounts (inline boot-fallback markup, v0.5.1).
curl -s https://inventar.hoodhood.ai/ | grep -q 'boot-fallback' && echo "shell OK"

# 2. Health endpoint.
curl -fsS https://inventar.hoodhood.ai/health   # → ok

# 3. SW delivery is not edge-cached. v0.6.7 (ADR-036) caught Cloudflare
#    rewriting our `no-cache` to `max-age=14400` on /sw.js, which
#    silently froze merchants on stale builds for hours. Both checks
#    below should pass after every deploy. If /sw.js comes back with
#    `cf-cache-status: HIT` or any `max-age > 0`, the consent modal
#    will not fire for any release — see DEPLOY.md §5b.
curl -sI https://inventar.hoodhood.ai/sw.js \
  | grep -iE 'cache-control|cf-cache'
#   → cache-control: no-store, no-cache, must-revalidate, max-age=0
#   → cf-cache-status: BYPASS
curl -sI https://inventar.hoodhood.ai/whats-new.json \
  | grep -iE 'cache-control|cf-cache'
#   → cache-control: no-store, no-cache, must-revalidate, max-age=0
#   → cf-cache-status: DYNAMIC
```

The inline boot-fallback markup (v0.5.1) should be in every deployed HTML response.

### Rollback

There's no scripted rollback. To roll back:

```bash
git log --oneline -10                 # find the last-good commit
git checkout <commit>                 # detached HEAD
./scripts/deploy.sh                   # rebuild + push
git checkout main                     # back to main
```

The merchant's IndexedDB is forward-only (Dexie versions). A deploy of an older bundle whose Dexie max-version is BELOW the user's IDB version will refuse to open and trigger the boot fallback. Tell the merchant to use Settings → Maintenance → Clear app cache & reload, OR clear site data via Chrome.

---

## 2. Tests

### Vitest (unit + kernel)

```bash
cd /opt/inventar/web
npm test              # full suite
npm test -- src/db    # subset by path
```

Currently 434 tests across 39 files. `npm run preflight` runs `typecheck + lint + test` in one command.

### Playwright (e2e)

```bash
cd /opt/inventar/web
npx playwright test --project=mobile-chromium                    # full mobile-chromium suite (~7 min)
npx playwright test --project=mobile-chromium e2e/tests/50_*.ts  # one file
npx playwright test --project=mobile-chromium --grep "fashion"   # by test name
```

Currently 161 tests across 60 files. `mobile-webkit` and `mobile-firefox` projects exist but are **NOT routinely run** — most v0.5.1+ work was validated against mobile-chromium only.

### CI

No remote CI. Runbook = "preflight + e2e on the dev machine before pushing."

---

## 3. Stuck-PWA recovery (the merchant's phone)

The most common support request: "the app won't open." Triage:

| Step | Action | What it tells you |
|---|---|---|
| 1 | Ask merchant to open `https://inventar.hoodhood.ai/` and wait 10s | If the inline boot fallback's "Loading is taking too long" UI appears with a "Clear cache & reload" button, the SW is stuck. Tap the button. |
| 2 | If they get a blank screen with no fallback UI | The HTML itself didn't load. Check Cloudflare + nginx logs: `docker logs --tail 50 inventar_web`. |
| 3 | If the fallback's Clear button doesn't work | Have them clear site data via Chrome: three-dot menu → Site settings → `inventar.hoodhood.ai` → Clear & reset. |
| 4 | If the app loads but is in a weird state | Have them open Settings → Maintenance → Clear app cache & reload. IndexedDB is preserved. |
| 5 | If their data is gone after clearing | The IndexedDB was wiped by the OS / they used the destructive "Reset everything" option. Restore from a backup file via Onboarding → "I have a backup file". |

**On the deploy side** (your responsibility): re-deploying with `./scripts/deploy.sh` does NOT auto-recover stuck merchants. The boot fallback is the in-PWA recovery surface; it covers most cases.

---

## 4. Schema migrations

Schema lives in `web/src/db/db.ts`. Current Dexie version: **9** (v0.5.2 ADR-021 / 022 / 023).

### Inspecting a merchant's IDB

If a merchant reports a problem, ask them to share their export file (Settings → Backup & sync → Export Data). Inspect locally:

```bash
# The export is a JSON file; key fields:
# - rows.profile[0].store_type (fashion / shop / shoes / clothes)
# - rows.profile[0].fashion_subtypes / shop_subtypes
# - meta keys: migration_v6_completed_at, migration_v7_completed_at, migration_v9_completed_at
```

### Adding a new schema version (v10 onwards)

1. **Write the kernel first** — `src/db/migrate-vN-to-vN+1.ts`. Pure function over plain JS rows. Returns `{rows: {profile, articles, ...}}`. Use the `migrate-v8-to-v9.ts` shape as the template.
2. **Add vitest** — `migrate-vN-to-vN+1.test.ts`. Cover idempotency (re-running on already-migrated rows is a no-op).
3. **Wire into `db.ts`**:
   ```ts
   this.version(N+1).stores({...}).upgrade(async (tx) => {
     const completed = await tx.table('meta').get(META_KEYS.migration_vN+1_completed_at);
     if (completed?.value) return;
     // ... read → kernel → write → set meta
   });
   ```
4. **Update `META_KEYS`** in `src/repos/meta.ts`.
5. **Add an e2e test** that seeds a vN-shape IDB, reloads, asserts the upgraded shape (template: `e2e/tests/50_v8_v9_migration.spec.ts`).
6. **Update `backup/import.ts`** if the migration touches imported v1 backups.
7. **Document in `DECISIONS.md`** with a new ADR.

### Things slated for removal (per NON_GOALS.md)

In v0.7+:
- `meta.expiry_threshold_days` — replaced by `ShopProfile.expiry_warning_days` (ADR-023).
- Legacy `StoreType` union members `'shoes'` / `'clothes'` — kept for v8→v9 back-compat (ADR-021).
- Legacy `ShopSubtype` keys `'tobacco_lottery'` / `'parapharmaceutique'` — preserved on existing profiles, not in the picker (ADR-018).

---

## 5. Common file locations

```
/opt/inventar/
├── DATA_MODEL.md            ← Type definitions, Dexie schema, migrations
├── SPEC.md                  ← Per-screen behaviour
├── DECISIONS.md             ← ADRs (ADR-021..025 are v0.5.2)
├── NON_GOALS.md             ← What we don't build + scheduled removals
├── PROJECT.md               ← Glossary, positioning
├── TESTING.md               ← Test pyramid + e2e file map
├── DEPLOY.md                ← VPS infra
├── RUNBOOK.md               ← This file
└── web/
    ├── src/db/db.ts                      ← Dexie schema, all version()s
    ├── src/db/migrate-v[N]-to-v[N+1].ts  ← Pure migration kernels
    ├── src/repos/                        ← One file per IDB table
    ├── src/repos/meta.ts                 ← META_KEYS catalogue
    ├── src/screens/                      ← One file per route
    ├── src/components/                   ← Shared UI
    ├── src/hooks/                        ← React hooks (use-profile, use-locale, use-location-labels)
    ├── src/config/store-types.ts         ← Vertical configs
    ├── src/config/shop-subtypes.ts       ← Shop subtype catalogue
    ├── src/config/fashion-subtypes.ts    ← Fashion subtype catalogue + size_hint values
    ├── src/i18n/locales/{en,fr,ar}.json  ← All UI strings
    └── e2e/tests/                        ← Playwright specs
```

---

## 6. Recovery checklist

If `main` is broken and tests fail:

```bash
git status                    # confirm what's dirty
git log --oneline -5          # the last 5 commits
npm run preflight             # what's red?
npx playwright test --project=mobile-chromium --reporter=list 2>&1 | tail -30
```

If it's a single bad commit:

```bash
git revert <hash>             # creates a new commit that undoes the bad one
./scripts/deploy.sh           # push the revert
```

Never `git reset --hard` on a deployed `main`. Always revert.

---

## 7. Smoke-test recipe (sign-off before tagging a release)

```bash
cd /opt/inventar/web
git status                                             # clean
npm run preflight                                      # 100% green
npx playwright test --project=mobile-chromium          # 100% green
# Optional: cross-browser (slow)
npx playwright test --project=mobile-webkit
npx playwright test --project=mobile-firefox
# Build a fresh dist + smoke the boot fallback in the deployed HTML
./scripts/deploy.sh
curl -s https://inventar.hoodhood.ai/ | grep -q 'boot-fallback' && echo "OK"
```

---

## 8. Useful one-liners

| Need | Command |
|---|---|
| List every Dexie version | `grep -E "this.version\\(" web/src/db/db.ts` |
| List every e2e file | `ls web/e2e/tests/*.spec.ts` |
| List every i18n key | `grep -oE '"[a-z_]+_label"' web/src/i18n/locales/en.json \| sort -u` |
| Find dead i18n keys (best-effort) | `for k in $(grep -oE '"[a-z_]+"' web/src/i18n/locales/en.json); do c=$(grep -rn "$k" web/src --include='*.tsx' --include='*.ts' \| wc -l); if [ "$c" = 0 ]; then echo "$k"; fi; done` |
| Find every migration in chained order | `grep -l "migrateRowsV" web/src/db/` |
| Verify deployed bundle | `curl -s https://inventar.hoodhood.ai/ \| md5sum` |

---

## 9. Known limitations (current as of v0.5.2)

These are accepted trade-offs documented elsewhere; included here so they're easy to find at 2am:

- **No mobile-webkit / mobile-firefox CI**. Most v0.5.1+ was validated against mobile-chromium only. If a Safari/Firefox bug surfaces, run those projects locally and fix.
- **No Settings → fashion-subtypes editor**. Fashion merchants can only change subtypes via the migration confirmation screen (one-shot post-migration). Listed in the v0.5.2 audit as a follow-up.
- **`/receive` and `/sell` are routable for fashion** but not in fashion's bottom nav. They render but expect shop UX (expiry input, etc). Either hide them entirely for fashion OR adapt them — pending decision.
- **No Lot breakdown panel on Article Detail**. Spec'd but only the data exists. Lots surface in Quick Adjust dropdown + /alerts expiring tab + dashboard widget count.
- **`pairsSold` field name is shoes-flavoured** even for shop. Cosmetic.
