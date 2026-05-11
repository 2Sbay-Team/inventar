# Inventar — Product Specification (v1.0)

This document defines what the MVP does, screen by screen, flow by flow. Companion documents handle data shapes (`DATA_MODEL.md`), architectural rationale (`DECISIONS.md`), what we are explicitly *not* building (`NON_GOALS.md`), deployment (`DEPLOY.md`), and tests (`TESTING.md`).

---

## 1. User stories

The merchant must be able to:

1. Install the app on a phone or tablet from a URL, with no app-store account required.
2. Pick a language and type a shop name on first launch — done in under 30 seconds.
3. Add a new article in under 60 seconds: photo → name → sizes → quantities → prices → save.
4. Search the catalogue in mixed Arabic, French, or English (e.g. "blanc 42", "أبيض ٤٢", "white 42") and get an answer in under 200 ms while offline.
5. Adjust a size's stock with a single tap (sale: −1; restock: +N).
6. View today's, this week's, and this month's revenue, profit, and pairs sold.
7. Log a fixed expense (delivery, rent, electricity) in under 10 seconds.
8. Switch between French, Arabic (RTL, Eastern numerals), and English without restarting the app.
9. Use the app fully offline indefinitely. The app never displays a "you are offline" warning.
10. Export their entire data as a single JSON file via the OS share sheet (WhatsApp, Drive, email, AirDrop).
11. Import a previously-exported JSON file, replacing or merging with current data (with confirmation).
12. Archive a discontinued article without losing its sales history.

---

## 2. Screens

### 2.1 First-launch onboarding

Sequence:

1. **Language picker** — three large buttons, FR / AR / EN. Default highlight on the device locale if it matches one of them; otherwise FR.
2. **Shop name** — single field. One field. No password, no email, no account creation. (e.g. "Naili Shoes")
3. **Backup reminder card** — short message: *"Your data lives only on this device. Settings → Export Data lets you back up to WhatsApp, Drive, or email. We'll remind you weekly."* Single "Got it" button.
4. **Lands** on the empty Search screen with a hint pointing at the `+ Add` tab.

Edge cases:

- Shop name empty → block "continue".
- The whole onboarding works offline (it is local-only). No network is consulted at any point.

### 2.2 Search (the daily home)

The most-used screen. Default tab.

Layout (mobile, ~360 px wide):

```
[Status bar]
[Header: shop name | "X articles · Y items"]
[Search bar — single line, debounced 150 ms]
[Recent searches — 3 chips]
[Result list — scrollable, each card 70 px tall]
[Bottom nav: Search · List · + Add · Dashboard · Settings]
```

Search behaviour:

- Tokens split on whitespace and comma.
- Each token matched against: article.name, article.brand, article.colors, article.internal_code, variant.size.
- Numbers in tokens (Eastern Arabic or Western) normalised to a canonical form before matching.
- Diacritics stripped.
- Results ranked: exact-size match in stock first, exact-size match out-of-stock second, partial matches third, archived last.
- Each result card shows: photo thumbnail, name, internal_code, sale price, stock badge.
- Stock badge text varies by query:
  - If query mentions a size and it's in stock: "In stock · N in size X"
  - If query mentions a size and it's out: "X out · A and B in stock" (suggesting neighbouring sizes)
  - If no size in query: "N pairs total · X sizes"

Empty states:

- **No articles yet** — empty illustration, headline "Add your first article", primary button "+ Add an article".
- **No matches for query** — "Nothing found for `query`. Try fewer words or different words." Plus an "+ Add as new article with this name" shortcut.

### 2.3 Article detail

Layout:

```
[Top bar: ← back | SH-XXXX (tappable to copy) | ⋯ menu]
[Hero photo — 16:11 aspect]
[Title block: name, color, brand, category]
[Pricing strip: Cost · Sale · [Stock badge]]
[Sizes — 5-column grid, all sizes seen for this article]
[Recent activity — last 8 movements with timestamps]
[Action bar: − Sell  |  + Restock]
```

Size grid behaviour:

- Each cell shows: size value (large), quantity (small below).
- Cells coloured by state: `has` (green), `zero` (gray dimmed), `focus` (cognac, set when navigated from a search query that included this size).
- Tap a cell → Quick Adjust modal (2.4).
- Long-press a cell → "Hide this size" (cosmetic only, data preserved).

`⋯` menu options:

- Edit article (opens form pre-filled)
- Take new photo
- Archive article (soft delete with `archived_at`)
- Delete forever (hard delete, requires "type DELETE to confirm")

### 2.4 Quick Adjust modal

Bottom sheet covering ~50% of screen, dismissible by swipe-down.

```
[Size 42 of "White running shoe"]
[Current: 2 pairs]
[ − ]  [ 1 ]  [ + ]      ← stepper, default value 1
[Reason: ◉ Sale  ○ Return  ○ Adjustment  ○ Restock]
[Optional note: text input]
[Cancel]    [Confirm]
```

On Confirm:
- Append a new Movement: `{variant_id, delta: ±N, type: reason, note, at: now()}`
- The Article detail screen's size grid and recent activity update without a navigation jump.
- If reason = Sale, an animated +revenue indicator briefly shows the cash impact.

### 2.5 Add Article

Photo-first form. The keyboard does not appear before a photo is taken.

```
[Top bar: Cancel | Add article | step indicator]
[Photo CTA — required, opens camera on tap]
─ once photo taken, CTA replaced by photo + small "retake" link ─
[Form fields:]
  Code        — auto-filled (SH-XXXX), uneditable by default
  Name        — required, free text
  Color       — chips: white, black, brown, blue, red, beige, multi, custom
  Brand       — optional, free text with autocomplete from previous
  Category    — chips: sport, dress, casual, kids, women, men
  Sizes       — comma-separated, parsed to an array (e.g. "39, 40, 41, 42")
  Qty/size    — stepper, default 1
  Cost (TND)  — required, numeric
  Sale (TND)  — required, numeric
[Action bar: Save and add another | Save]
```

Validation:

- Photo required. Save buttons disabled until photo present.
- Name min 2 characters.
- Sizes parsed into integers; invalid characters highlighted inline.
- Cost ≤ Sale enforced as a soft warning ("you'll lose money on this — continue?"), not a hard block.
- All numeric inputs accept Eastern Arabic digits and normalise to Western for storage.

On save:
- Article record persisted to IndexedDB.
- Variant records created (one per size; v0.3 fans this out per (colour, size) cell).
- Initial purchase movement records created (one per non-zero floor / back cell, type: purchase).
- Camera resource released.
- If "Save and add another": photo resets, form keeps Color/Brand/Category as defaults for the next entry.

**v0.5 (ADR-017).** For the shop vertical, Step 1 also offers an
optional "Reorder when stock drops below" input that writes
`Article.min_stock_threshold`. Setting it surfaces the "Low (N left)"
chip in Search/List and bumps the dashboard's Items-running-low
widget once stock drops below the value. Shoes / clothes do not
render the input (the field is shop-shaped). `Article.barcode_ean`
is **not** surfaced in Add Article — the canonical entry point for a
barcoded item is `/receive`, which auto-fills the EAN from the scan
and creates the article via the same repo path. A merchant adding a
non-barcoded item (fresh produce, bread) leaves `barcode_ean` null.

### 2.6 Dashboard

Tab in bottom nav.

Period selector at top: **Today** | Week | Month | Year. Default Today.

Three big numbers (mono digits, large weight):

```
Revenue       Net profit       Pairs sold
290 TND       92 TND           4
```

Below — the cash-flow breakdown:

```
Cash this period:
  Revenue (sales)         +290
  Purchases (new stock)   −150
  Expenses                 −60
  ──────────────────────────
  In pocket                +80

Profit on what sold:
  Gross profit            +142
  Expenses                 −50
  ──────────────────────────
  Net profit               +92
```

Below — top 3 selling articles (this period), each a small card with name + qty sold + revenue.
Below — Activity feed: sales, purchases, expenses, archives, all interleaved chronologically.
Floating button: "+ Add expense" — opens the expense modal.

**v0.5 shop widgets (ADR-018).** Three cards render at the top of
the Dashboard for shop merchants only (gated on
`profile.store_type === 'shop'`):

- **Today's close** — sum of revenue for sale movements created
  since today's local midnight, count of distinct
  `transaction_id` values (plus per-row count for legacy
  Quick-Adjust sales with `transaction_id=null`), and the top
  seller (article name + qty). One-line summary.
- **Items running low** — number of articles with
  `min_stock_threshold` set AND total stock below it. Tap navigates
  to `/list?filter=low` (the filter wiring on /list is a follow-up).
- **Expiring soon** — number of variants with at least one Lot
  whose `expires_at` falls within the merchant-configured threshold
  AND whose snooze (`expiry_snooze_${variantId}`) isn't currently
  active. Tap navigates to `/expiry`. Same predicate as the Search-
  screen banner.

Non-shop verticals never render the widgets — the section returns
null at `ShopWidgets`.

### 2.7 Expense modal

```
[Category chips: 🚚 Transport · 🏠 Rent · ⚡ Electricity · 📶 Internet
                 📦 Packaging · 🧾 Taxes · ⋯ Other]
[Amount: TND input]
[Note: optional text]
[Date: defaults to now]
[Recurring: ○ Just today  ○ Weekly  ○ Monthly]
[Save]
```

If recurring is set, on every app launch a job runs and backfills any skipped recurrences (e.g. if the merchant didn't open the app for 3 weeks, the system creates 3 weekly expense rows for any weekly recurring expense).

### 2.8 List

Plain catalogue browse, separate from search. Sort options: Recently added · A→Z · Lowest stock · Highest profit margin. Filter by category. Toggle "Show archived".

### 2.9 Settings

```
Language               > FR / AR / EN
Currency display       (locked to TND in MVP)
Shop name              > edit
Backup ──────
  Export data          > generates JSON, opens OS share sheet
  Import data          > pick JSON file, choose merge or replace
  Last backup          > timestamp of last export
Archive bin            > shows archived articles, allows restore
Storage                > "X MB used", "Refresh persistence" (calls navigator.storage.persist)
About                  > version, build date, contact info for the code owner
Reset everything       > destructive, requires typed confirmation
```

---

## 3. Backup and restore

Because data lives only on the device, backup is the user's responsibility. The app:

1. **Prompts weekly.** On Monday morning of any week where no export has happened in 7 days, the home screen shows a small banner: "Time to back up your data. Tap to export." Dismissable.
2. **Generates a single JSON file** containing every row in IndexedDB, including photos as base64. The file is named `inventar-backup-YYYY-MM-DD.json`.
3. **Triggers the OS share sheet** so the user can send it to WhatsApp, Drive, email, AirDrop, or save to local storage. Implementation uses `navigator.share()` with a Blob if available, falling back to a download.
4. **Imports** by file picker. The user is asked: replace current data, or merge (taking newest `updated_at` per row).
5. **Includes integrity hash** at the bottom of the JSON. Import verifies it before applying.

The same JSON format also serves as the migration path if the user ever switches devices.

---

## 4. Localisation

Three locales at launch: **fr** (default), **ar**, **en**.

Implementation rules:

- All UI strings come from `i18next` resource files. No hard-coded strings in JSX.
- The Arabic locale automatically applies `dir="rtl"` to `<html>`.
- The Arabic locale uses Eastern Arabic numerals for all user-facing numbers via a `formatNumber(n, locale)` utility.
- SKU codes (`SH-0042`), unit labels (`TND`, `4G`), and other technical identifiers stay LTR/Western in all locales.
- Search input normalises Eastern Arabic digits to Western before indexing.
- Date formatting respects the locale (`Intl.DateTimeFormat`).
- Currency formatting: `Intl.NumberFormat(locale, {style:'currency', currency:'TND'})`.

---

## 5. Performance targets

| Metric | Target |
|---|---|
| Time to interactive (cold launch, cached) | < 1.5 s on a 2020 Android phone |
| Search results render (any query, 500 articles) | < 200 ms |
| Add Article save (with 3 MB photo) | < 1.5 s including compression |
| Photo storage per article (after compression) | ≤ 200 KB |
| Total IndexedDB usage at 500 articles | ≤ 100 MB |
| App shell size on disk | ≤ 2 MB gzipped |

Search performance achieved by: (a) maintaining a denormalised search index (`search_blob` column on Article) updated on every edit, (b) using Dexie compound indexes, (c) debouncing input by 150 ms.

---

## 6. Validation rules

| Field | Rule |
|---|---|
| Article.name | min 2 chars, max 80 chars |
| Article.brand | max 40 chars, optional |
| Article.color | required, from a closed list + custom |
| Article.category | required |
| Article.cost_price | ≥ 0, numeric, max 99999 TND |
| Article.sale_price | ≥ 0, numeric, max 99999 TND |
| Variant.size | required, alphanumeric, max 8 chars |
| Movement.delta | non-zero integer |
| Expense.amount | > 0, numeric |
| Expense.category | required, from closed enum |
| Shop name | min 2, max 50 chars |
| Photo file | image/* MIME, max 10 MB before compression |

---

## 7. Update delivery

Service worker uses cache-first precache (workbox `precacheAndRoute`) for the app shell. When a new build is deployed:

1. The current session continues with the old version uninterrupted.
2. The service worker downloads the new shell into a separate cache and reaches `waiting` state.
3. **(v0.6 ADR-030 amendment.)** The new shell does NOT auto-activate. A blocking modal (`AppUpdateModal`) opens with the new version, the highlights from `/whats-new.json`, and three options:
   - **Install now** — sends `SKIP_WAITING`, waits for `controllerchange`, reloads. After reload a one-shot "Welcome to vX" toast surfaces.
   - **Remind me tomorrow** — writes `update_snooze_until = now + 24 h`. Modal is suppressed for the snoozed version until the timestamp passes. A different waiting version re-prompts immediately.
   - **Skip this version** — appends to `update_skipped_versions`. Same version never prompts again; future versions still prompt.
4. The modal is fully blocking (no outside-click dismiss, no Esc) but each of the three options is a first-class outcome. The active SW keeps serving the cached shell while the new SW waits.
5. If `/whats-new.json` is missing or fails to load (404, malformed, offline), the modal still appears with a generic "improvements and bug fixes" copy and a `__unknown__` skip sentinel so the merchant isn't stuck in a re-prompt loop.

No forced reload mid-session — reload happens only on the merchant's explicit Install click. No background download progress UI.

---

### 2.10 Settings additions (v0.5, shop only)

- **Shop sub-types** (ADR-017) — multi-select chip card; Save writes
  `ShopProfile.shop_subtypes`. The selection drives Add Article's
  default category list (union of selected sub-types' default
  categories) and the dashboard widgets. Validation: at least one
  sub-type must remain selected.
- **Expiry warning threshold** (ADR-019) — chip group
  (3 / 7 / 14 / 30 days) writing `META_KEYS.expiry_threshold_days`.
  Tap saves immediately. The Search-screen banner, /expiry default
  filter, and the dashboard Expiring-soon widget all read this value.

### 2.11 /receive (v0.5 ADR-018, shop only)

Camera-first scan-driven receiving. Replaces Add Article in the shop
bottom nav (Add Article remains reachable via direct URL for the
rare non-barcoded item).

```
[Top bar: Done | Receive Stock | session counter "N items received"]
[Camera viewfinder fills the body]
[Floating "Type instead" button — bottom right]
```

On detect (or manual entry) the screen runs:
1. `normalizeEan` + `isPlausibleScannableCode` (12 or 13 digits, all
   numeric); invalid → red banner "Invalid barcode".
2. `findArticleByEAN`. **Match** → bottom sheet with current stock
   (from `quantityFor` across the article's variants), qty stepper,
   optional expiry date input. Save appends one purchase Movement
   (`location='back'`, `transaction_id=session UUID`, `expires_at`
   set if entered) and, when expiry was set, a corresponding Lot row.
   **No match** → bottom sheet with mini-form: name, optional photo,
   cost, sale, category (chips drawn from the merchant's
   `shop_subtypes`), qty, optional expiry. Save calls `createArticle`
   with `barcode_ean=ean` then patches the seed Movement with the
   session's transaction_id + expiry; Lot row created if expiry set.
3. While a sheet is open, further detections are ignored. Done
   navigates back to /. The session UUID is stable for the lifetime
   of the screen so every Movement created groups under one
   `transaction_id`.

The "Type instead" sheet accepts a 12/13-digit string (short-circuits
to the same handler as a real scan), an internal_code (e.g. `GR-0042`),
or a free-text product-name search.

### 2.12 /sell (v0.5 ADR-018, shop only)

Camera-first scan-driven checkout. Same shape as /receive, but
accumulates a cart of items and commits the whole transaction at the
end.

```
[Top bar: Cancel | Sell + cart-count chip | session counter (taps to open drawer)]
[Camera viewfinder fills the body]
[Peek strip — bottom: "{N} in cart · TND total" when non-empty]
[Floating "Type instead" — bottom right]
```

Cart semantics:
- One CartRow per Article. A second scan of the same EAN bumps the
  row's qty (capped at the current stock).
- The FIFO Lot is picked when the row is first added (not at Done):
  earliest `expires_at` with remaining > 0. Null for non-perishable
  items.
- Tap the cart-count chip to open the drawer; rows show name × qty
  + line total + +/− stepper + Remove. Continue scanning closes the
  drawer; Save commits.
- On Save: one sale Movement per cart row with
  `delta=-row.qty, type='sale', location='floor',
  transaction_id=session UUID, lot_id=row.lot_id, unit_price_tnd=null`
  (uses the article's catalogue price; per-sale discounts go through
  the existing Quick Adjust path).
- A scanned EAN that resolves to a sized vertical's article (clothes
  / shoes with `barcode_ean` set) is rejected with toast "open it
  manually" — the user should use Quick Adjust which handles
  per-(colour, size) sales.

### 2.13 /expiry (v0.5 ADR-019, shop only)

List of variants with at least one alive Lot in the active filter
window. Default filter "this week" (≤ 7 days); filter chips also
offer "today" / "this month" / "all upcoming" (365 d). Reachable
from the Search-screen expiry banner and the dashboard
Expiring-soon widget.

Each row:
- Article name + internal_code + sum of remaining (across this
  variant's lots in the window).
- Earliest expiry: red chip if past, warn-soft chip if within
  threshold, neutral otherwise.
- Actions: **Discount** (disabled in v0.5; planned), **Mark damaged**
  (writes a damage Movement for the earliest-lot's remaining +
  `softDeleteLot(earliestLotId)`), **Hide 7 days** (writes
  `expiry_snooze_${variantId}` meta with `(now + 7d).iso`; the banner
  predicate honors snoozes).

Snoozed rows render at 60 % opacity but stay actionable so the
merchant can change their mind.

---

## 8. Out of scope for this spec

Anything not listed above. See `NON_GOALS.md`. The most important non-goals are: multi-device sync, cloud backup, customer database, employee accounts, automated alerts, AI photo recognition, multi-store, payment processing, invoice printing.

---

## 9. v0.5.2 additions

### 9.1 Two verticals

ADR-021 merged shoes + clothes → 'fashion' (parallel to ADR-017's
kiosk + grocery → 'shop'). Onboarding offers two verticals:

- **fashion** — sized + coloured, browse-driven, sku_prefix=`FN`. Sub-types: shoes, shoes_kids, clothing_men, clothing_women, clothing_kids, accessories, bags, jewelry. Each has a size_hint that drives Add Article's autocomplete.
- **shop** — scan-driven, expiry-aware, sku_prefix=`SP`. Sub-types: 14 predefined (food_beverages, fresh_produce, bakery_pastry, snacks_confectionery, frozen_foods, personal_care, cosmetics_beauty, health_otc, household_cleaning, kitchenware_homegoods, stationery, toys_baby, pet_supplies, electronics_accessories) + custom strings.

Legacy 'shoes' / 'clothes' / 'kiosk' / 'grocery' values stay readable for back-compat with v8 IDBs but are no longer in the picker. Removed in v0.7+.

### 9.2 Custom subtypes

Both pickers expose an inline "+ Add another category" affordance that opens a 30-char text input. Custom strings are stored verbatim in `shop_subtypes` / `fashion_subtypes` arrays, displayed as removable chips, and round-trip through backups. They do NOT contribute to the category-suggestion union (only predefined keys have `categories` lists).

### 9.3 Onboarding flow (v0.5.2)

`language → intent → name + vertical → subtypes (per vertical) → locations → backup card → search`.

The locations step pre-fills `location_floor_label` / `location_back_label` from `defaultLocationLabels(vertical, locale)`. Merchant can override; clearing reverts to the default. Same editor lives in Settings → Stock locations.

### 9.4 /alerts screen (replaces standalone /expiry)

Two tabs:

- **Stock running low** — articles with `min_stock_threshold` set AND current stock below threshold. Per-article alerts only — no global low-stock default.
- **Expiring soon** — lots within `expiry_warning_days` (or article's `expiry_alert_days` override). Hidden for non-shop verticals. Actions: Discount / Mark damaged / Hide for 7 days per variant.

Routing: `/alerts` defaults to the low tab; `?tab=expiring` opens directly to the expiring tab. `/expiry` is a permanent redirect to `/alerts?tab=expiring`.

### 9.5 Migration banner + confirmation screen

Shows on Search after a v8→v9 upgrade (gated on `migration_v9_completed_at` AND NOT `migration_v9_subtypes_confirmed_at`). Tap → `/migrations/confirm-subtypes`. "Hide for 7 days" stamps `migration_v9_banner_hidden_until`. Onboarding stamps `migration_v9_subtypes_confirmed_at` so fresh installs never see the banner.

### 9.6 AlertsBanner with snapshot reappearance

Above ExpiryBanner on Search. Aggregates low-stock + expiring counts. "Hide for 7 days" stamps both `alerts_banner_hidden_until` AND `alerts_banner_hidden_count_snapshot`. Banner re-shows if current count exceeds snapshot — handles the "new alert arrives mid-suppression" case.

### 9.7 Quick Adjust manual lot override

When a shop variant has ≥2 alive lots with remaining > 0 AND reason is sale or return, a Lot dropdown appears above the reason picker. Default = FIFO (earliest expiry). Selected lot becomes `Movement.lot_id` on the resulting movement.

### 9.8 Per-article fields

- `Article.min_stock_threshold: number | null` — already from v7. Article Detail exposes the editor for shop articles (gated on `storeCfg.has_expiry`).
- `Article.expiry_alert_days: number | null` (NEW v9) — overrides global `expiry_warning_days`. Same editor location, shop-only.

### 9.9 Per-prefix internal_code counter

ADR-024. `nextInternalCode(db, prefix)` returns `max(tail-where-prefix-matches) + 1`, anchored on `${prefix}-`. Legacy SH/CL/KI/GR codes from before v0.5.2 stay in place; new fashion / shop articles allocate FN- / SP- starting at PFX-0001 within their prefix.

### 9.10 Customisable location labels

`ShopProfile.location_floor_label` / `location_back_label` (max 30 chars). Internal `Movement.location` enum stays 'floor' / 'back' for storage and indexing — labels are a pure display alias. Defaults are locale + vertical-aware. Read via `useLocationLabels()` hook.

### 9.11 Defensive layers (v0.5.1, recap)

- Inline boot watchdog in `index.html` — 10s timeout shows "Clear cache & reload" if React doesn't mount.
- Top-level `<ErrorBoundary>` catches render-time crashes.
- Settings → Maintenance "Clear app cache & reload" — unregisters SWs + clears Cache Storage. IndexedDB untouched.
- `formatCurrency` always emits a currency marker even on stripped-down ICU builds.
- PhotoPicker: explicit Camera + Gallery buttons in Add Article + Receive (Android picker workaround).
- Scanner accepts Inventar's own QR URL (`https://inventar.hoodhood.ai/article/{uuid}`) and `internal_code` short-IDs in addition to EAN.
