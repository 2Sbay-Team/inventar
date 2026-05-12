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

## ADR-021: Vertical consolidation (shoes + clothes → fashion)

**v0.5.2.** ADR-017 already merged kiosk + grocery into shop. This
consolidation merges shoes + clothes into a single 'fashion'
vertical. Both store_types had identical config (sized + colored,
add-first flow) and forced the merchant to misclassify themselves
when they sold both. Sub-categorisation moves to per-merchant
`fashion_subtypes` (multi-select), parallel to ADR-017's
`shop_subtypes`.

**Migration v8→v9** (idempotent, gated on
`migration_v9_completed_at`):

- `store_type='shoes'` → `'fashion'`, `fashion_subtypes=['shoes']`
- `store_type='clothes'` → `'fashion'`,
  `fashion_subtypes=['clothing_men', 'clothing_women']`
- `store_type='shop'` and existing `'fashion'` unchanged
- All migrated profiles get a one-time confirmation banner on the
  home screen; `migration_v9_subtypes_confirmed_at` dismisses it
  permanently. `migration_v9_banner_hidden_until` allows a 7-day
  snooze without confirming.

**StoreType union** keeps 'shoes' and 'clothes' as legacy values
for one release so reads from a v8-shape IDB during the upgrade
window don't crash. STORE_TYPES still has entries for them
(sku_prefix SH/CL). Removed in v0.7+.

## ADR-022: Stock location labels are merchant-customisable

**v0.5.2.** The internal `Movement.location` enum stays
'floor' / 'back' for storage and indexing — this is a pure display
alias. ShopProfile gains `location_floor_label` and
`location_back_label` (strings, max 30 chars). Defaults are
locale-aware AND vertical-aware:

|        | EN              | FR                  | AR              |
|--------|-----------------|---------------------|-----------------|
| Fashion floor | Shop floor     | Boutique          | المحل           |
| Fashion back  | Stockroom      | Réserve           | المخزن          |
| Shop floor    | Shelf          | Rayon             | الرف            |
| Shop back     | Stockroom      | Réserve           | المخزن          |

Onboarding pre-fills the inputs; merchant can override. Settings →
Stock locations exposes the same editor post-onboarding. Clearing a
field reverts to the locale + vertical default (NOT the merchant's
own customised value, so "clear to restore" works as expected).

**Read path**: `useLocationLabels()` returns `{ floor, back }`.
Every UI surface that displays a location reads via this hook.

**Why customisable strings instead of pre-shipped translations**:
the merchant's vocabulary is theirs (a Naili merchant might call
the back zone "le dépôt" or "le magasin de derrière"); freezing it
to one phrase per locale would feel like Inventar telling them how
to talk about their own shop.

## ADR-023: Per-article alert thresholds override global defaults

**v0.5.2.** Two per-article fields supplement the global expiry +
low-stock thresholds:

- `Article.min_stock_threshold` (already existed in v7) — when set,
  triggers a low-stock alert for THIS article. There is no global
  low-stock default per ADR-018; alerts only fire when the merchant
  explicitly opted in.
- `Article.expiry_alert_days` (NEW in v9) — overrides
  `ShopProfile.expiry_warning_days` for THIS article. Null = use
  the global. Only meaningful for shop articles with at least one
  Lot; ignored for fashion articles (no expiry tracking).

**Why per-article**: a merchant who sells fresh bread (1-day
expiry) and canned tuna (years) wants different alert thresholds
for each. A single global threshold either spams the merchant
about tuna or misses the bread.

## ADR-024: Internal code prefixes use independent per-prefix counters

**v0.5.2.** Pre-v9, `nextInternalCode` scanned ALL articles and
returned `max(tail) + 1` regardless of prefix. Switching store_type
left the new prefix continuing the old prefix's max — a kiosk that
had reached `GR-0156` would allocate `FN-0157` as the first fashion
code. Confusing for the merchant ("why does my first fashion item
have number 157?") and breaks the "labels printed for `SH-*` still
map to a meaningful sequence" assumption.

**New behaviour**: per-prefix `max + 1`, anchored on `${prefix}-`.
`SH-0042` + `FN-0008` → next FN code is `FN-0009`. Empty per-prefix
history → starts at `PFX-0001`. Legacy SH/CL/KI/GR codes stay in
place untouched; new fashion / shop articles use FN / SP going
forward.

## ADR-025: New predefined sub-types in future versions never auto-assigned

**v0.5.2.** When Inventar adds new predefined sub-types in v0.6+,
they appear as new options in the picker. **Existing profiles are
NEVER auto-assigned new sub-types** — the merchant must opt in via
Settings → Categories. Migration logic only runs once per major
version (gated on `migration_vN_completed_at` meta keys).

**Why**: a merchant who's already classified themselves shouldn't
suddenly find their dashboard widgets shifting because Inventar
shipped a new predefined. The category list is the merchant's
declaration about THEIR shop, not a rolling inventory of
Inventar's taxonomy.

## ADR-026: Size suggestions on Add Article are sub-type + category-aware quick chips; free text always accepted

**v0.5.6.** Two related decisions about the size-input UX on the
Add Article form:

1. **Quick-tap chips reflect the merchant's stock.** The
   `<datalist>` next to the size input draws its options from the
   selected fashion sub-types' `size_hint` mapping. A shoes-only
   merchant sees EU 36-46; a clothing_men-only merchant sees
   letter sizes S-XXXL; an accessories merchant sees no chips.

2. **The article's CATEGORY narrows the pool further.** A merchant
   who stocks shoes AND clothing_men, adding an article with
   category 'shirts' (which only belongs to clothing_men), sees
   only letter sizes — the EU shoe chips don't pollute the list.
   When the category doesn't match any sub-type (a custom typed
   category, or a sub-type set whose categories don't include the
   chosen one), we fall back to the all-sub-types union so the
   merchant still has SOMETHING to tap. Implementation:
   `sizeHintValuesForCategory(subtypes, category)` in
   `web/src/config/fashion-subtypes.ts`.

3. **Shop vertical surfaces six package-size chips** (`250ml` /
   `500ml` / `1L` / `500g` / `1Kg` / `5Kg`) when the merchant opts
   into per-article sizes on a sizeless block. Constant
   `SHOP_PACKAGE_SIZES`, same file.

**Free text is always accepted.** The chips are pure hints — the
`<input>` accepts any string and stores it verbatim. A merchant
typing 'Petit' or '36.5' or 'one size' persists exactly that.
The chips trade off discoverability for breadth: they shorten the
common case to one tap without locking the merchant out of
arbitrary values.

**Why narrow instead of union always?** The all-sub-types union
that v0.5.2.9 shipped worked fine for single-vertical merchants
but produced confusing 20+ chip rows for a fashion merchant who
ticked both shoes and clothing_men. Real-world testing surfaced
this as the #1 complaint on the Add Article form. Narrowing by
category removes the noise without making the list user-
configurable (which would have been another preference to manage).

## ADR-027: Article master data is product-intrinsic only. Tax, expenses, discounts, and stock live in separate domains.

**v0.5.6 — affirming an architectural boundary that came up
during v0.5.6 polish discussions.** Several adjacent feature
requests (tax rate per article, expense tracking on articles,
discount fields) would each have added a column or two to the
Article row. Each in isolation is small; together they collapse
the Article table into a kitchen-sink dumping ground.

**Decision.** The Article table holds ONLY product-intrinsic
attributes: name, photo, brand, category, internal_code, EAN,
cost / sale price, unit_of_measure, alert thresholds, and the
boolean traits (has_sizes, has_colors, has_expiry). Anything that
is NOT inherent to the product — every transactional, financial,
or operational concern — lives in its own table:

- **Tax** (rates, categories, included-vs-added) → deferred to
  v0.7 with its own `TaxRate` and `ArticleTaxCategory` tables.
  ADR to be written under the v0.7 work.
- **Expenses** → already in the separate Expenses domain (per the
  existing Dashboard / expense-modal flow). Articles never carry
  an "expense" field.
- **Discounts** → applied per-sale via the Quick Adjust modal's
  `unit_price_tnd` override (ADR-014). Not an article field.
- **Stock** → ADR-002 (Movement-as-truth). Articles never store a
  `quantity` column.
- **Customer / document references** → forthcoming v0.8 document
  layer; will live in `Document` and `RecentCustomer` tables.

**Why this matters.** Each candidate field looks innocent on its
own, but every column on Article that ISN'T product-intrinsic
fights the cache-locality of the catalogue (one row read pulls
in irrelevant data), erodes the mental model ("what is an
Article, exactly?"), and tempts callers to read fields they
shouldn't (a tax rate read off Article instead of TaxRate would
silently use a stale value after a tax-rule change). Drawing the
line now — explicitly — saves us from a cleanup pass later.

**If a future contributor wonders whether tax / expense /
discount / stock belongs on Article: the answer is NO.** Add a
new domain table and reference it by `article_id` instead.

## ADR-028: Logo background auto-removal via color-key Canvas API; no ML dependency; cross-browser fallback for older iOS Safari

**v0.5.4 hotfix.** Merchants typically grab logos from Google
search, screenshots, or basic graphics tools — almost all arrive
with a solid white (or near-white) box around the artwork. On
the app's cream theme that box is glaring. Auto-remove the
background at upload time, then ask the merchant to confirm.

**Algorithm** (`web/src/utils/logo-transparency.ts`):

1. After the existing `compressPhoto` pass produces a JPEG blob,
   decode it via `createImageBitmap` and downscale to ≤ 800 px on
   the longest edge.
2. Sample the four corner pixels (1 px inset, so JPEG block noise
   doesn't dominate) and compute their mean RGB.
3. Gate the keying on three thresholds applied to that mean:
   BT.709 luminance > 0.85, HSL saturation < 0.15, and
   cross-corner stddev < 15 sRGB. Real-world photos fail at least
   one of these → keying is skipped.
4. If the gate passes, scan every pixel: Euclidean RGB distance
   to the mean corner colour < 25 → alpha = 0; 25–35 → alpha =
   128 (the anti-alias band that prevents halos against the cream
   theme); otherwise alpha unchanged.
5. Encode the result as PNG. If > 95 % of pixels were keyed (the
   "logo" was really just a coloured rectangle) reject the result
   and surface a clear error.

**Cross-browser**: `OffscreenCanvas` where available (Chrome 69+,
Edge 79+, Firefox 105+, Safari 16.4+), `HTMLCanvasElement`
fallback for iOS Safari 14–16.3. The branch decision uses a
`typeof OffscreenCanvas !== 'undefined'` guard rather than a bare
`instanceof` check, because `canvas instanceof OffscreenCanvas`
throws `TypeError` when the global is undefined — and that's
exactly the environment the fallback path is supposed to cover.

**UX**: when keying succeeds, show a side-by-side preview
(`LogoPreviewDialog`) with the original and the keyed version.
Default selection is the transparent version. The merchant can
override and "Keep original" — both branches store a real Photo
row, with mime `image/png` for transparent or `image/jpeg` for
original, so downstream renderers (invoice PDF in particular)
know what they're dealing with. When the gate skips or the
keyer errors, the upload still completes silently with the
original compressed JPEG; the merchant always ends with a logo.

**Why not ML?** A pre-trained background-removal model (U²-Net,
MODNet) is 20–80 MB. The app's entire JS bundle is ~750 KB
gzipped. For the 95 %+ case where the merchant uploaded a
plain-background logo, a four-corner colour-key is correct,
deterministic, and ships in ~10 KB of Canvas code. The rare
photographic logo doesn't justify the bundle hit, especially
when the merchant can always pick "Keep original".

## ADR-029: Onboarding location picker switches to a localized dropdown; vertical-specific defaults retire from the picker UI (migration defaults stay)

**v0.6.** ADR-022 made the floor/back labels merchant-customisable
with locale+vertical defaults exposed as free-text inputs in
onboarding and Settings. Typing on mobile in any language (Arabic
especially) was slow; merchants asked for taps, not text.

**Decision.** The picker UI becomes a 3-option `<select>` per zone
with a `+ Type your own` fallback that swaps to an inline text input.
Same option list across both verticals (one curated set per locale —
no Fashion/Shop branching):

|        | EN                       | FR                          | AR                          |
|--------|--------------------------|-----------------------------|-----------------------------|
| Floor  | Shop floor* / Display / Front | Magasin* / Boutique / Comptoir | المحل* / الواجهة / العرض |
| Back   | Stockroom* / Storage / Back | Réserve* / Stock / Arrière | المخزن* / التخزين / المستودع |

`*` = pre-selected default. The stored value is the literal label
string (no enum), so a merchant who picks the FR "Boutique" gets
"Boutique" persisted to `ShopProfile.location_floor_label`, the
same as before. `useLocationLabels()`, the `Movement.location` enum,
and the schema are untouched.

**What stays.** The v8→v9 migration's vertical+locale defaults
(`Shelf` / `Rayon` / `الرف` for shop+locale, `Shop floor` / `Boutique`
/ `المحل` for fashion+locale) keep firing for pre-existing profiles.
Those values seed the field on first migration and propagate through
`useLocationLabels()`. When such a profile lands in the new dropdown,
the picker detects the stored value isn't in the new option list
and renders in custom mode with the legacy value pre-filled — the
merchant sees their existing text, can keep it or switch to a
predefined option. No data migration.

**Why same-list across verticals.** A Tunisian boutique merchant
and a Tunisian shop merchant call the front of their store similar
things; carrying two separate option lists in code split the choices
without a corresponding mental-model split for the merchants. The
brief explicitly mandates this.

**v0.6.1 amendment — Settings reads the runtime UI locale, not
`profile.locale`.** The Settings dropdown originally indexed
`LOCATION_OPTIONS[profile.locale]`, which is the locale frozen at
onboarding time. A merchant who onboarded in EN and later switched
the UI to FR/AR via the language picker still saw the EN option
list, even though the labels above the dropdown translated
correctly via i18next. `StockLocationsSection` now reads the
current locale through `useLocale()` so the option list tracks the
live UI language. Onboarding was already correct (it consumes
`useLocale()` for the same reason).

**v0.6.3 amendment — storage uses locale-neutral keys, not display
strings.** The v0.6.1 fix made the dropdown options follow the UI
locale, but the stored *value* was still a display string ("Shop
floor" / "Magasin" / "المحل"). When a merchant who picked "الواجهة"
in Arabic later opened Settings in French, the stored "الواجهة" was
not in the FR option list and `SelectWithCustom` flipped into its
custom-input fallback — the user saw a text input instead of a
dropdown, with raw Arabic text inside. The same applied to
EN ↔ FR ↔ AR pairs in every direction.

Storage now uses one of three canonical shapes:

| Form              | Example                       | When                                |
|-------------------|-------------------------------|-------------------------------------|
| FrontKey / BackKey| `shop_floor` / `stockroom`    | Merchant picked a predefined option |
| `custom:<value>`  | `custom:Tiroir A`             | Merchant typed via "+ Type your own"|
| (empty / unset)   | `''` / `undefined`            | Pre-onboarding state                |

`FRONT_OPTIONS_BY_KEY` and `BACK_OPTIONS_BY_KEY` in
`web/src/config/location-options.ts` hold the key → display
mapping per locale. `useLocationLabels` resolves a stored key to
the current locale's display at render time; a `custom:`-prefixed
value gets its prefix stripped and renders verbatim across all
locales (no auto-translation, per the original ADR-022 promise).
The hook also tolerates raw legacy display strings as a final
fallback so a v6 / v7 profile that bypassed the v13 migration
still renders coherently.

Reverse lookup is **zone-aware**. The display string "Back" exists
both as the EN display for the back-zone `back` key and as a
plausible custom-typed value in the front zone. `frontKeyForDisplay`
only searches the three front-zone keys' displays, and
`backKeyForDisplay` only the back-zone's, so a merchant who types
"Back" in the FRONT field is preserved as `custom:Back` rather
than coerced into the wrong-zone `back` key.

The Dexie **v12 → v13 upgrade** walks every `profile` row and
rewrites the legacy display strings via `normaliseFrontLabel` /
`normaliseBackLabel`. The migration is idempotent: re-running on
already-keyed values is a no-op, and re-running on
already-`custom:`-prefixed values does not double-wrap them.

Known limitation. A merchant who literally types `custom:foo` as
their label is recognised as already-prefixed by
`normaliseFrontLabel` (its `isCustomValue` guard prevents
double-wrapping for migration idempotency), so storage is
`custom:foo` and the resolver renders `foo` — the visible
prefix gets stripped on next render. This is a documented
footgun, not a correctness bug: real shop-location names never
look like `custom:…`, and the trade-off vs. switching to a more
escaped sentinel (e.g. `__c:`) is preserving the idempotency the
v13 migration depends on.

## ADR-030: QR labels gain centered branding (logo or store name); error correction M → Q; in-app scan QR stays plain

**v0.6.** Printed QR labels used to show only the QR pattern.
Merchants wanted labels that looked branded — store logo or name
in the centre — without breaking scan reliability.

**Algorithm** (`web/src/utils/qr-branding.ts` + `components/article-qr.tsx`):

1. Generate the QR at error correction level **Q** (was M). Level Q
   recovers up to ~25 % of the modules, the budget the centre
   overlay eats into. Level M would barely cover the 22 %-edge
   overlay and would fail on imperfect prints.
2. Post-process the qrcode lib's SVG output: parse the `viewBox`,
   compute the centered 22 %×22 % square, and inject either
   - an `<image href="data:image/...;base64,…">` element backed by a
     white `<rect>` (so a logo with transparent corners doesn't let
     the QR modules show through), or
   - a `<rect>` + `<text>` element carrying the truncated store name
     (12 char cap, ellipsis suffix).
3. The overlay is added ONLY when the label screen passes a
   `branding` prop to `<ArticleQR>`. Article Detail's on-screen
   QR dialog leaves it undefined, keeping the in-app QR plain for
   fastest in-app scanning.

**Logo source.** `ShopProfile.logo_photo_id` (in place since v0.5).
The v0.5.4 logo auto-keying pipeline (ADR-028) strips white
backgrounds before the logo lands as a Photo row; that improvement
is upstream of this ADR and already on main.

**Why not pdf-lib?** Labels are still exported via `window.print()`
("Save as PDF" in the print dialog). Switching to a programmatic
PDF generator would add ~200 KB to the bundle and a second rendering
pipeline for one screen; the SVG-print path already produces the
same paper-or-PDF result on every OS the app targets.

**Why 22 % edge?** Industry-standard QR-branding sizing: a 22%×22%
centred occluder covers ~5 % of the QR's pixels, well within level
Q's 25 % recovery budget. Tested round-trip via jsQR on both
mobile-chromium and mobile-webkit.

## ADR-031: Updates require explicit user consent. No silent service-worker activation.

**v0.6.** Workbox-window's default lifecycle calls
`registration.waiting.skipWaiting()` automatically whenever a new
SW reaches the `waiting` state, swapping in the new shell on the
next page load. Merchants experienced this as the app "changing
under them" — a surprise version bump mid-day, sometimes with new
UI affordances or moved buttons. For a small shop running on a
single phone, that surprise erodes trust.

**Decision.** A newly-installed SW stays in `waiting` until the
merchant explicitly consents via a blocking modal
(`AppUpdateModal`). The modal offers three choices:

- **Install now** — `wb.messageSkipWaiting()` → wait for
  `controllerchange` → `window.location.reload()`. Post-reload, a
  one-shot toast surfaces the new version.
- **Remind me tomorrow** — writes `update_snooze_until = now + 24 h`
  + `update_snoozed_version = vX`. The modal is suppressed for that
  exact version until the timestamp passes. A different waiting
  version re-prompts immediately (snooze is per-version, not global).
- **Skip this version** — appends to `update_skipped_versions`. The
  modal NEVER re-prompts for that version. Future versions still
  prompt normally.

The active SW continues serving the cached shell while the new SW
waits. Offline behaviour (ADR-001 / SPEC §7) is unchanged.

**Whats-new.json.** Each release ships
`/public/whats-new.json` with `{version, released_at, highlights:
{en, fr, ar}}`. The hook cache-busts the fetch
(`/whats-new.json?_=<Date.now()>`) so the active SW's precache
doesn't intercept and serve the OLD version's highlights. The
authoritative answer to "what version is available" is what the
deployed file declares; no separate version source or build-time
injection.

**Fallback path.** If `/whats-new.json` is 404, malformed, or fails
the shape guard (e.g. the merchant is offline when the SW finishes
installing), the modal still appears with a generic "improvements
and bug fixes" copy. The three buttons still work; snooze and skip
use a `__unknown__` sentinel so the merchant doesn't get stuck in a
re-prompt loop.

**SPEC §7 amendment.** The pre-v0.6 wording "no forced reload
mid-session" stays correct in spirit — the reload now happens only
on the merchant's explicit click, not silently.

**Why not banner / toast?** A passive banner is dismissable; the
merchant can ignore it indefinitely while accumulating divergence
between their installed code and the deployed reality. The blocking
modal demands one of three explicit decisions, but each decision is
respected: Snooze and Skip are first-class outcomes, not nags.

**Why a 24 h snooze?** Matches OS-level update prompts (Windows,
macOS). Short enough that a real fix lands soon; long enough that a
merchant in the middle of inventory work isn't re-prompted every
five minutes.

## ADR-032: Update modal adapts to a `risk_level` field on whats-new.json — safe / migration / breaking layouts with mandatory backup gate on breaking

**v0.6.2.** The v0.6 consent modal (ADR-031) treats every release
identically: three buttons, no information about whether the update
modifies the merchant's data or changes the backup format. A
merchant who taps Install on a migration update without warning
could face a backup that no longer round-trips, or a data shape
they didn't expect. For a single-phone retail app where the
merchant IS the IT department, that loss of agency is unacceptable.

**Decision.** `whats-new.json` gains an optional `risk_level` field
with three values, plus optional `migration` and
`backup_format_change` blocks describing the change. The same
`AppUpdateModal` renders three layouts keyed off the value:

| Level       | Header             | Body                                   | Primary           | Secondary               |
|-------------|--------------------|----------------------------------------|-------------------|-------------------------|
| `safe`      | Sparkles, accent   | Highlights + ✓ data unaffected lines   | **Install now**   | Snooze / Skip           |
| `migration` | Package, warn      | Highlights + warning block + export hint | **Install now**   | Snooze / Skip           |
| `breaking`  | AlertTriangle, bad | Highlights + strong warning + REQUIRED export | **Cancel — I'll prepare first** | Install (disabled until export tapped); no Snooze / Skip |

The `migration` block carries `{summary: {en,fr,ar},
data_affected[], data_preservation, rollback_supported}`. The
`backup_format_change` block carries `{from, to,
backwards_compatible_import, forwards_compatible_export}`.

**Strict validator.** A `risk_level` of `migration` or `breaking`
WITHOUT a fully-shaped migration block fails `isValidWhatsNew`. The
caller falls through to the `SKIP_SENTINEL_UNKNOWN` fallback path —
generic copy, no warning. This is deliberate: silently downgrading
a malformed risky update to a reassuring safe layout would defeat
the purpose. Missing `risk_level` (legacy v0.6 files) normalizes
to `safe`, so the schema is fully backwards-compatible for the
files that already ship to production devices.

**Snooze key is composite — `(version, risk_level)`.** When the
same version is republished with a higher risk level (e.g. safe →
migration after a hotfix to whats-new.json), the mismatch
invalidates an in-flight snooze and the modal re-prompts at the
heavier warning. Stored as a new meta key
`update_snoozed_risk_level`.

**Breaking updates bypass both snooze AND the skipped-versions
list.** A 'breaking' risk_level forces `shouldPromptForUpdate` to
return true regardless of prior consent state. The merchant cannot
suppress a non-rollback-able update; they can only **Cancel — I'll
prepare first**, which closes the modal transiently. The next page
load (or hook re-mount with the SW still waiting) re-prompts. This
is the "force consideration" rule.

**Known limitation: skip is not invalidated on safe → migration
upgrade.** Skipped versions are stored as plain version strings, not
(version, risk_level) tuples. A merchant who tapped Skip on v0.5.7
as 'safe' will NOT re-see the modal if v0.5.7's whats-new is later
republished as 'migration'. The brief's clarifying question only
asked about snooze; the migration risk level is the lighter tier
(no rollback warning), so the silent suppression is acceptable.
'breaking' republishes bypass skip anyway, so the worst case is
always covered. Revisit if real-world authoring patterns produce
many safe → migration upgrades.

**Export-backup state is local, not persistent.** The merchant's
"I've exported a backup" toggle is React state inside the modal
component. It resets every time the modal re-opens. A backup taken
yesterday isn't a pre-install snapshot for today's upgrade —
forcing a fresh export per modal session keeps the implied
commitment honest. The export pipeline itself is shared with
Settings → Export Data via `web/src/backup/download.ts`; both
callers take the same `exportBackupBlob → anchor click →
markBackedUp` path.

**Trust limit on Export.** The browser's save dialog isn't
observable from JS. The modal can detect that the click handler
completed without throwing (anchor click dispatched, blob handed
to the browser), not that the merchant actually picked a save
destination. This matches the existing Settings flow, which has
treated `markBackedUp` as a post-click side-effect since v0.1. A
merchant who hits Export and then cancels the OS save dialog still
gets the ✓ indicator and the Install button enabled on breaking —
ergonomic, but not a security boundary.

**SPEC §10 amendment.** `APP_VERSION` was duplicated as
`const APP_VERSION = '1.0.0'` in three callers (`settings.tsx`,
`use-auto-backup.ts`, `app-update-modal.tsx`). RESOLVED in v0.6.3 by
extracting `web/src/config/app-version.ts` as the single source of
truth; all three call sites now import from there. v0.6.7 bumped to
`'1.0.1'`. The Vite `define` route is no longer pursued — the
config-module pattern is simpler and just as correct.

---

## ADR-033: Location labels stored as locale-neutral keys (or `custom:` prefix); rendered via per-locale tables at read time

**v0.6.3.** ADR-022 / ADR-029 introduced merchant-customisable
display labels for the two stock zones (`location_floor_label` /
`location_back_label` on the profile row). Until v0.6.2 those
fields stored the literal display string the merchant picked or
typed — "Shop floor" / "Magasin" / "المحل" / "Tiroir A". A
locale-specific value worked fine until a merchant changed the
app's UI locale: their stored "الواجهة" then showed as raw
foreign text in EN/FR, and SelectWithCustom (correctly) flipped
into custom-input fallback mode because the stored string wasn't
in the new locale's options. Reported by users as "the dropdown
disappears in EN/FR" and "my labels turned into Arabic gibberish
after I switched language".

**Decision.** Storage shape is now zone-aware **keys**:

  * Front zone keys: `shop_floor` / `display` / `front`.
  * Back zone keys: `stockroom` / `storage` / `back`.
  * Merchant-typed custom value: stored with a `custom:` prefix
    and the verbatim string after it (`custom:Tiroir A`).
  * Empty / unset: falls through to the (vertical, locale)
    default at render time, same as ADR-022.

`useLocationLabels` resolves all four forms:

  1. Empty / null → vertical+locale default (back-compat with
     pre-v0.5.2 rows).
  2. Known `FrontKey` / `BackKey` → look up the current UI
     locale's display via `FRONT_OPTIONS_BY_KEY` /
     `BACK_OPTIONS_BY_KEY` tables.
  3. `custom:*` → strip the prefix, render verbatim.
  4. Legacy plain display string → zone-aware reverse lookup
     (`frontKeyForDisplay` / `backKeyForDisplay`) so v6 / v7
     profiles that skipped the v13 migration still render
     correctly; falls through to verbatim only if no known
     locale display matches.

**Zone-aware reverse lookup matters.** The display string "Back"
is the EN label for the BACK-zone `back` key. A merchant who types
"Back" into the FRONT field expects it preserved as a custom
value, not silently coerced into a BACK key on a FRONT column
(which would then fail to resolve at render time because
`FRONT_OPTIONS_BY_KEY` doesn't carry that key). The reverse-lookup
helpers scan only the keys of their own zone.

**Migration.** Dexie v12 → v13 walks every profile row through
`normaliseFrontLabel` / `normaliseBackLabel` — the same helpers
Settings + Onboarding call at write time. Idempotent: rows that
already store a key or a `custom:` value pass through unchanged.
Empty / undefined fields are left as-is (the render-time fallback
to defaults handles them).

**Why a key table instead of i18next.** Three zones × three
locales × three keys is small enough that a typed map literal
(`Record<Locale, Record<FrontKey, string>>`) is easier to read and
test than threading i18next namespacing through the picker
component. The translations don't need pluralisation or
interpolation; the key table sits in `config/location-options.ts`
next to the order array.

**Test coverage.** 8 unit cases in `migrate-v12-to-v13.test.ts`
pin the migration rule (EN/FR/AR rewrite, custom preservation,
zone-collision, idempotency, skip-empty). 3 e2e cases in
`82_location_keys_locale_swap.spec.ts` cover the end-to-end
locale-swap contract — pick "Magasin" in FR → swap to EN → see
"Shop floor", same `display` key.

**Migration banner / non-impact.** No banner shown; the migration
runs silently on app open. The visual outcome is "labels suddenly
work right across locale switches"; merchants who only ever use
one locale see no change. The migration completes in <1ms even on
a 100-profile (impossible) database, so there's no perceptible
upgrade cost.

---

## ADR-034: Global Floating Action Button — route-aware visibility, RTL-flipping inline-end position

**v0.6.4.** Catalogue-shaped screens (`/`, `/list`) and the
dashboard had grown long enough that the bottom-nav "Add" tab
required a scroll to reach on tall lists. The dashboard had a
local labelled-pill `add-expense-fab` button as a workaround;
search and list had nothing.

**Decision.** A single `<Fab />` component, mounted inside
`ScreenLayout` so it positions within the centred app shell
(`absolute end-6 bottom-20`), self-determines visibility from
`useLocation()`:

  * `/` and `/list` → "Add new article" → `navigate('/add')`.
  * `/dashboard` → "Add expense" → dispatches a document-level
    `inventar:fab-trigger` event; dashboard listens via `useEffect`
    and opens its existing Add-Expense dialog.
  * Everywhere else → returns `null`.

The dispatched-event pattern (vs. lifting modal state up or
threading callbacks) keeps the modal state inside whichever screen
owns the dialog. The Fab only signals; screens that care
subscribe.

**Hidden routes:** `/add` (already on the destination),
`/settings*`, `/onboarding`, `/alerts`, `/help`, `/receive` and
`/sell` (camera screens), the various detail / report /
QR-label paths.

**`/article/:id` deliberately excluded.** The detail screen
already exposes Sell + Restock in a sticky action-bar; adding a
FAB there would double-up the affordance and overlap the bar
geometrically. The brief asked for it but also pinned "do not
touch existing screen layouts or components" — the cleaner end
state honours that constraint and leaves article-detail untouched.
If the FAB needs to land there later, the action-bar should be
reworked in the same change.

**Layout.** 56 px circle, `bg-accent` (#FF6B35), white "+" icon,
`shadow-[0_4px_12px_rgba(0,0,0,0.15)]`, `absolute bottom-20 end-6
z-30`. `end-6` is Tailwind's logical inline-end property — flips
to bottom-left under `dir="rtl"` (Arabic) without per-locale
classes. `absolute` (not `fixed`) keeps the FAB pinned to the
centred shell on tablets / desktops rather than the raw viewport
edge.

**Contrast caveat.** White-on-`#FF6B35` is ≈ 2.81 : 1, below the
WCAG 1.4.11 graphical-objects 3 : 1 floor and far below AA-text
4.5 : 1. The brief asked for the brand-primary colour and we
followed; the icon is `aria-hidden` so screen-reader users get the
button's `aria-label` instead. If strict AA becomes load-bearing,
swap `bg-accent` for `bg-accent-ink` (`#C44417` → ≈ 5 : 1, passes
AA).

**Dashboard cleanup.** The legacy labelled-pill
`add-expense-fab` was removed in this commit — the global circular
FAB triggers the same Dialog via the document-event subscription,
and having two floating buttons on the dashboard would be
visually noisy. The existing `06_dashboard.spec.ts` test was
re-pointed at `data-testid="fab"`.

**Test coverage.** 6 e2e cases in `85_fab.spec.ts`: visibility
audit across visible / hidden routes, /list and / taps both
navigate to /add, /dashboard tap opens the expense sheet, AR
locale flips x-coordinate to the start side of the shell, long
scroll keeps the FAB pinned to the viewport y.

---

## ADR-035: Merchant chooses what appears at the centre of printed QR labels — logo or store name

**v0.6.5.** Until v0.6.4 the QR-label renderer (ADR-030)
automatically preferred the logo when one was uploaded, falling
back to the shop name. Merchants asked for an explicit choice
because shop-name-in-centre reads clearer on small printed labels
than a tiny stamped logo, and some merchants who upload a logo for
the invoice header don't want it on every product label.

**Decision.** New `ShopProfile.qr_center_mode: 'logo' | 'name'`,
controlled from a radio picker in Settings → Shop profile (live
preview alongside) and respected by every label render site
(`/settings/label-preview`, `/article/:id/label`, and the
Settings live preview itself).

**Auto-fallback / auto-promote rules** (`deriveQrCenterMode`):

  1. Caller-supplied mode wins, except `'logo'` with no logo →
     coerced to `'name'`. The renderer never sees an unrenderable
     `(logo, null)` pair, so it doesn't need its own fallback.
  2. Existing `'logo'` with no logo (the merchant just deleted
     theirs) → `'name'` on the next write. Same as rule 1, applied
     to the existing-row path so the next render emit gets the
     corrected mode.
  3. Existing `'name'` AND no previous logo AND new logo on this
     write → auto-promote to `'logo'`. Models "merchant uploads
     their first logo, expects it on labels by default." Replacing
     an existing logo (so `existingLogo` was truthy) preserves
     `'name'` — an explicit choice isn't overridden.
  4. First-create default: `'logo'` if logo present, else
     `'name'`.

**UI primitive.** Settings uses Radix `RadioGroup`, not raw
`<input type="radio">`. The raw-input first pass hit a
controlled-radio-vs-async-side-effect race: the browser flipped
the radio's native `checked` attribute on click, but React didn't
re-render until `upsertProfile` resolved (async), so Playwright
read DOM state that briefly contradicted the controlled
`effectiveMode` prop. RadioGroup is a button-based primitive
driven by `data-state` from `value` — no native checked attribute,
no race. `QuickAdjustSheet` already used this primitive for the
same reason.

**Migration.** Dexie v13 → v14 backfills `qr_center_mode` on every
existing row: rows with a `logo_photo_id` get `'logo'`, the rest
get `'name'`. Idempotent — already-set rows skip the modify so the
upgrade is safe to re-run via a backup import that re-opens the
DB through the kernel.

**Hide the option vs. disable it.** When no logo is uploaded, the
"Show logo" radio is **hidden**, not just disabled. The brief was
explicit; a disabled-with-tooltip would have been busier with no
clear gain. The render-time `effectiveMode` collapses to `'name'`
for these rows so the live preview is faithful to what'll print.

**Backup round-trip.** v1 / v2 / v3 backups predate the field;
`backfillV05Defaults` in the import path applies the same
logo-presence-derived default the migration does, so an imported
row looks identical to an in-place-migrated row.

**Test coverage.** 5 unit cases in `migrate-v13-to-v14.test.ts`,
3 new repo-level cases in `profile.test.ts` (auto-promote on first
logo, preserve explicit 'name' across logo replace, auto-fallback
on remove), 7 e2e cases in `86_qr_center_preference.spec.ts`
(no-logo / toggle / delete / long-name truncation / reload /
FR+AR translation).

---

## ADR-036: Service-worker delivery requires `no-store` at origin AND a Cloudflare cache-bypass rule

**v0.6.7.** Field investigation on 12 May 2026 — after multiple
clean deploys of v0.6.3 / v0.6.4 / v0.6.5 — found merchants stuck
on stale builds for hours. None of the recent feature commits
reached devices. The bundles were live at origin; the service
worker that should have detected them never reached the browser.

**Reproduction.**

```
$ curl -sI https://inventar.hoodhood.ai/sw.js
  cache-control: max-age=14400              ← what CF sent
  cf-cache-status: REVALIDATED

$ docker compose exec inventar_web wget -S -O /dev/null http://127.0.0.1/sw.js
  Cache-Control: no-cache                   ← what origin sent
```

Origin's `no-cache` was being rewritten by Cloudflare's "Browser
Cache TTL" (Free plan default for `.js` files) to `max-age=14400`,
so every merchant's browser cached `/sw.js` for 4 h after each
visit. The next visit served the cached old SW. Update detection
froze on every release.

**Decision — two-part fix, both required.**

**Part 1 (origin).** `docker/nginx.conf` now emits the strongest
"do not cache" header set we can send for `/sw.js`,
`/whats-new.json`, `/index.html`, and `/manifest.webmanifest`:

```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
Pragma: no-cache
Expires: 0
```

`/sw.js` additionally carries `Service-Worker-Allowed: /`. The
`always` modifier reapplies these on 304 / error responses (the
previous plain `add_header` skipped non-2xx). Empirically the
stronger `no-store` was enough to convince Cloudflare Free to
honour origin headers — `cf-cache-status` flipped from
`REVALIDATED` / `EXPIRED` to `BYPASS` / `DYNAMIC` immediately
after deploy. We don't know whether the trigger was the
`Service-Worker-Allowed` advert, the `no-store` directive, or the
`Pragma:no-cache` belt; we know all three together work today.

**Part 2 (Cloudflare dashboard).** Documented in DEPLOY.md §5b
as a one-time setup step: Cache Rules that explicitly Bypass for
`/sw.js` and `/whats-new.json`. The origin fix is empirically
sufficient on the current Free plan but isn't covered by any
Cloudflare SLA — if CF defaults change, the dashboard rule is the
durable belt and origin headers become the suspenders. Verification
curl + one-time edge purge are in the same DEPLOY.md section.

**Why `no-store` instead of just `no-cache`.** `no-cache` permits a
cache to store the response and revalidate on every request — and
CF Free was historically using that latitude to "store with edge
TTL override". `no-store` says "don't keep this response anywhere
at all"; cleaner intent, harder to override, and has no downside
for files that already revalidate on every load.

**App-layer no-op.** The v0.6 ADR-031 update-consent flow is
unchanged. `skipWaiting: false`, message-gated activation via
`SKIP_WAITING`, `useAppUpdate` subscribing to the `waiting` event
— all already correct. The bug was at the delivery layer.

**Version bump as a forcing function.** v0.6.7 also bumped
`APP_VERSION` 1.0.0 → 1.0.1 and refreshed `public/whats-new.json`
to v1.0.1 with current EN/FR/AR highlights (About + manual update
check, the FAB, QR centre preference). The bump ensures the SW
content hash differs so the next edge revalidation actually serves
fresh bytes; the whats-new refresh gives the consent modal something
meaningful to show on first install of the unblocked pipeline.

**Side-effect: Settings → "Check for updates" now works on first
deploy.** The manual-check feature (v0.6.3 / ADR — unwritten,
covered in this batch via the SPEC.md screens addition) shipped
in d51abda but was never reachable from a stale-SW browser. With
v0.6.7 unblocking the pipeline, the manual check actually
completes its `registration.update()` → 'waiting' → modal cycle.
