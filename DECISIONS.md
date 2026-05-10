# Inventar — Architectural Decisions

Each ADR documents a load-bearing decision: what we chose, what we rejected, and why. If you disagree with a decision, propose a new ADR superseding it; do not silently change behaviour.

---

## ADR-001: PWA, not a native app

**Status:** Accepted.

**Context:** Need an installable mobile-first app distributable to many merchants, with no app-store dependency, on a one-developer budget.

**Decision:** Progressive Web App (Vite + React + TypeScript + Service Worker via vite-plugin-pwa). Installable from Chrome on Android via "Add to Home Screen". Same code runs on iPhone (via Safari), tablets, and desktops.

**Rejected alternatives:**

- *React Native or Flutter native* — too heavy for one developer, app-store review delays updates, requires per-platform certificate management.
- *Plain web app, no install* — no offline, no home-screen icon.
- *Capacitor wrapper* — adds build complexity for marginal UX gain over a well-designed PWA.

**Consequences:** Some platform features are limited (background tasks on iOS notably). Acceptable; we don't need them.

---

## ADR-002: Movement-as-truth for stock quantities

**Status:** Accepted.

**Context:** The merchant needs an audit trail to answer questions like "why is size 42 at zero now?". A naive `quantity` column erases history.

**Decision:** Variants do not store a `quantity` field. Quantity is computed at read time as `SUM(movements.delta WHERE variant_id = X AND deleted_at IS NULL)`. Each sale, restock, return, or adjustment appends a Movement row with a signed integer `delta`.

**Rejected alternatives:**

- *Stored quantity with separate `history` log* — duplicates state, two sources of truth, drift bugs inevitable.
- *Stored quantity, no history* — answers "what" but not "why".

**Consequences:**

- Audit trail is automatic.
- The architecture remains forward-compatible with multi-device sync if it's ever added back: append-only logs are conflict-free by construction.
- Slightly more compute per quantity read; negligible at any realistic data volume.

---

## ADR-003: No server, no sync, no accounts

**Status:** Accepted.

**Context:** The first user (Naili) needs the app on one phone. He does not have a tablet to sync to. Adding a sync layer adds a server, a database, an authentication system, conflict resolution, and at least a week of build time. None of that delivers value to a single-device user.

**Decision:** The MVP has no application server, no database server, no authentication, no accounts. Each install is fully independent. The user's data lives only in IndexedDB on their device. The VPS hosts only the static PWA files.

**Rejected alternatives:**

- *Postgres on the VPS for backup* — accumulates user data we'd then be liable for, and adds operational surface for marginal benefit (the user can export to JSON manually).
- *Firebase / Supabase* — same liability, plus vendor lock-in.
- *Local-only with optional sync flag* — half-built, hard to test, the un-used branch rots.

**Consequences:**

- The VPS literally cannot leak user data because it does not store any.
- If the user's phone is destroyed and they have no backup, their data is gone. Mitigated by weekly backup prompt and one-tap export.
- Multi-device usage is not supported. A future Phase 2 could add it; the data model is forward-compatible (UUIDs, append-only movements, `updated_at` everywhere).
- Build time drops from ~2 weeks to ~1 week.

---

## ADR-004: Soft delete via tombstones; hard delete only on explicit confirmation

**Status:** Accepted.

**Context:** Sales movements reference articles. Hard-deleting an article orphans its history and corrupts profit reports.

**Decision:**

- Sales, restocks, archives, and out-of-stock states never delete anything.
- "Archive article" sets `archived_at`. Hidden from default search, recoverable.
- "Delete forever" requires a typed confirmation (`type DELETE`). It hard-deletes the article and cascades to its variants, movements, photo. Used only for entry mistakes.

**Consequences:** Database grows with archives, but at human-merchant scale (≤ 10K archived articles) this is negligible.

---

## ADR-005: Currency stored as integer millimes

**Status:** Accepted.

**Context:** Floating-point arithmetic on prices accumulates rounding errors. JS `0.1 + 0.2 !== 0.3`.

**Decision:** All money fields stored as integers in millimes (1 TND = 1000 millimes). Display layer formats with appropriate locale decimals. Input layer parses user input back to millimes.

**Consequences:** No float arithmetic on money in business logic. UI conversion centralised in `formatCurrency()` and `parseCurrency()` utilities. Cost: must remember to convert at boundaries.

---

## ADR-006: Three locales at launch — fr (default), ar, en

**Status:** Accepted.

**Context:** Tunisian retail commonly uses French and Arabic. The merchant's mental model mixes both. English added for code-owner debugging and future expansion.

**Decision:**

- `i18next` for string resources.
- `dir="rtl"` on `<html>` when `locale === 'ar'`.
- Eastern Arabic numerals in the AR locale via a `formatNumber(n, locale)` utility, applied to all user-facing numbers.
- SKU codes, unit symbols, and other technical identifiers stay LTR/Western in all locales.
- Search input normalises Eastern → Western digits before indexing.

**Consequences:** All UI strings extracted; no hardcoded text in JSX. Adds a translator workflow if more locales come later — accept that.

---

## ADR-007: Dashboard is observational, not prescriptive

**Status:** Accepted.

**Context:** Tunisian retail pricing follows local context — relationships, season, neighbourhood reputation — that the app cannot see. Smart-feeling features that nudge the merchant ("raise this price") would feel patronising and erode trust.

**Decision:** The Dashboard shows numbers. It does not make recommendations, send alerts, or rank merchant decisions. Phase 3 work may add opt-in suggestions, but only after the merchant has used the observational dashboard for a meaningful period and explicitly asked for them.

**Consequences:** Lower perceived "AI value" up front. Higher trust over time. Easier to localise (no tone calibration per culture).

---

## ADR-008: Photos compressed to ≤ 200 KB before storage

**Status:** Accepted.

**Context:** Raw phone photos are 3–5 MB. At 500 articles, that's 2.5 GB in IndexedDB — past the storage quota on most Android devices and absolutely beyond iOS Safari's quota. Compressing to ~200 KB shrinks the same dataset to ~100 MB, which fits comfortably.

**Decision:** Use `browser-image-compression` to resize to max 1280 px wide and re-encode as JPEG quality 80 before storing. The compressed Blob is what goes into the Photo row.

**Consequences:** Photos lose some quality. For inventory recognition this is fine — the merchant uses the photo to recognise his own shoe, not for marketing.

---

## ADR-009: Backup is the user's responsibility, prompted weekly

**Status:** Accepted.

**Context:** Without a server backup, a destroyed phone means destroyed data. The user must export periodically.

**Decision:**

- Settings → Export Data generates a JSON file (with photos as base64) and triggers the OS share sheet via `navigator.share()`, falling back to a download.
- The home screen shows a backup prompt banner if it has been ≥ 7 days since the last successful export.
- The banner is dismissable but reappears the next week.
- The import flow accepts the same JSON format, with merge or replace options.

**Rejected alternatives:**

- *Mandatory backup, blocking the app until done* — paternalistic and breaks offline-first.
- *Auto-backup to a fixed cloud destination* — requires accounts and credentials we deliberately don't have.

**Consequences:** The merchant who ignores the prompt and loses their phone has no recourse. Documented at install. Acceptable trade-off given the architecture.

---

## ADR-010: Single-file static deployment behind Cloudflare Tunnel

**Status:** Accepted.

**Context:** The simplest possible delivery mechanism for a no-server PWA.

**Decision:** A single Docker container running `nginx:alpine` serves the built `dist/` folder. The existing cloudflared in `/opt/stack/` adds an ingress rule for `inventar.hoodhood.ai` → `inventar_web:80`. No application server. No database server. No additional services.

**Consequences:** Updates are `git pull && docker compose up -d --build`. Container restart takes 5 seconds. Service worker handles the seamless update on next user launch.

---

> ADRs 011–016 covered the v0.3 / v0.4 vertical-data work
> (colour-on-Variant, location-on-Movement, photo fallback, etc.) and
> live in the commit messages and inline `// ADR-NNN` comments. They
> are referenced from the v0.5 ADRs below but are not reproduced here
> until the v0.3/v0.4 doc backfill happens. v0.5 picks up at 017.

---

## ADR-017: Shop vertical merger (kiosk + grocery → shop)

**Status:** Accepted (v0.5).

**Context:** v0.4 had four verticals — shoes, clothes, kiosk, grocery.
Kiosk and grocery were functionally identical (factory-barcoded
consumer goods, fast turnover, expiry-sensitive, scan-driven). Field
testing found that splitting them created the appearance of
customisation without delivering different functionality, and forced
the merchant to misclassify themselves at onboarding (most small
minimarkets sell both food and tobacco).

**Decision:** Merge into one `'shop'` vertical with a multi-select
`shop_subtypes: ShopSubtype[]` field on the profile. The eight
canonical sub-types (food_beverages, tobacco_lottery,
snacks_confectionery, personal_care, household_cleaning,
parapharmaceutique, stationery, other) drive the default category
list in Add Article and shape the dashboard widgets. Existing kiosk
profiles map to `shop` + `['tobacco_lottery','snacks_confectionery']`
on first launch; existing grocery profiles map to `shop` +
`['food_beverages']`. Article also gains `barcode_ean` (indexed) and
`min_stock_threshold` (optional reorder threshold).

**Rejected alternatives:**

- Keep kiosk + grocery, deduplicate code internally — code dedup
  doesn't fix the misclassification at onboarding.
- One `'minimarket'` vertical without sub-types — loses the
  category-list signal that drives Add Article and the dashboard.

**Consequences:** Existing data is migrated by `migrate-v6-to-v7.ts`
(idempotent, pure kernel). Internal codes (KI-NNNN, GR-NNNN) are
preserved verbatim. The new `barcode_ean` index supports O(log n)
scanner lookups in /receive + /sell. `Variant.color` and
`Variant.size` stay null for shop articles — same uniform storage
shape as v0.3's sizeless / colourless verticals.

---

## ADR-018: Scan-driven flows are the primary entry for shop

**Status:** Accepted (v0.5).

**Context:** Shop merchants live with factory-barcoded items.
Requiring them to type names + sizes via Add Article for every new
purchase or sale would burn 10–15 seconds per item. The reference
model (Carrefour City running on a phone) is camera-first: scan
EAN, app increments / decrements, repeat.

**Decision:** Introduce `/receive` and `/sell`, both camera-first
screens with a "Type instead" manual fallback. The shop bottom nav
becomes Search · Receive · Sell · Dashboard · Settings (replaces
the Add and List slots — both stay reachable via direct URL for
edge cases). The non-shop verticals' nav is unchanged.

The scanner component (`barcode-scanner.tsx`) gains a
`keepOpenAfterDetect` prop with a 1500 ms per-value cooldown so
streaming-mode callers get one event per distinct code. /receive and
/sell inline the camera + BarcodeDetector wiring (rather than
nesting the Dialog-based scanner) because they need to layer their
own bottom sheets above the camera surface; if a third caller
appears, extract a `useBarcodeStream` hook.

EAN validation is **loose** in v0.5: 12 or 13 digits, all numeric,
no checksum check. Strict EAN-13 checksum validation is deferred
because real-world Tunisian retail barcodes (and the brief's test
fixtures) frequently fail strict validation.

**Consequences:** Add Article remains the canonical entry point for
non-barcoded shop items (fresh produce, bread, in-house products).
Shoes / clothes are unaffected. The session UUID groups all
movements created in one /receive or /sell visit under one
`transaction_id`, so the activity feed can collapse one cart of
five items into a single expandable row when that UI lands.

---

## ADR-019: Lots + automatic FIFO; manual override available

**Status:** Accepted (v0.5).

**Context:** Shop merchants stock perishable items in batches with
different expiry dates (yogurt received last week vs. yogurt
received yesterday). Ordering sales randomly from any batch wastes
the older stock. The merchant should not have to think about which
batch a customer's purchase comes from.

**Decision:** Add a `Lot` table indexed on
`[variant_id+expires_at]`. Lots are created automatically by /receive
when the merchant enters an expiry date; non-perishable items never
produce Lot rows. /sell calls `pickFifoLot(variantId)` which returns
the alive lot with the earliest `expires_at` that still has remaining
stock. The resulting sale Movement carries `lot_id = pickedLot.id`.
Lot.remaining is computed at read time as
`original_quantity − SUM(|delta|) for sale movements with lot_id =
this.id` — no stored counter (ADR-002 movement-as-truth holds).

`Movement.lot_id` is intentionally **not** indexed. Queries scope
by `variant_id` (which IS indexed) and filter by `lot_id` in memory;
the inner set is bounded — one variant's movements. The
remainingForLot fix in commit 4 made this the canonical pattern
after the initial commit-1 implementation tripped over a
"KeyPath lot_id is not indexed" Dexie error.

Manual override path: Article Detail's variant view can show a
per-lot breakdown so the merchant can sell from a non-FIFO batch
(e.g. a customer bringing their own Tupperware wants the last bit
of an opened jar). The UI surface for this is a future commit; the
data model already supports it (`recordMovement` accepts an
explicit `lot_id`).

**Consequences:** No background job — FIFO runs at scan time. The
audit trail names the specific batch each sale depleted, which
makes /expiry's "Mark damaged" surgical (only damages the earliest
lot, not the variant's entire stock).

---

## ADR-020: Expiry warnings are in-app banners, not push notifications

**Status:** Accepted (v0.5).

**Context:** ADR-007 says the dashboard is observational, not
prescriptive. Push notifications would be the most aggressive
prescriptive surface possible — and the PWA architecture (ADR-001)
makes them brittle on iOS in any case.

**Decision:** Expiry warnings surface as a yellow banner on the
Search screen and a dashboard widget, never as a push or browser
notification. The merchant chooses when to look. Per-variant
"Hide for 7 days" snooze writes a meta key
(`expiry_snooze_${variantId}`) the banner predicate honors; the
threshold (3 / 7 / 14 / 30 days) is a Settings card.

**Rejected alternatives:**

- Web Push notifications — iOS PWA support is recent and limited;
  silent on a backgrounded tab on Android.
- Email reminders — no email infrastructure; would require user
  accounts (forbidden by ADR-003).

**Consequences:** The merchant who never opens the app misses
expiring stock. Documented at install. Acceptable trade-off given
the architecture and ADR-007's tone.
