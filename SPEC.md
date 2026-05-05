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
- Variant records created (one per size).
- Initial purchase movement records created (one per variant, `delta: +qty`, type: purchase).
- Camera resource released.
- If "Save and add another": photo resets, form keeps Color/Brand/Category as defaults for the next entry.

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

Service worker uses a "stale-while-revalidate" strategy for the app shell. When a new build is deployed:

1. The current session continues with the old version uninterrupted.
2. The service worker fetches the new shell in the background.
3. On next launch, the new shell is active.
4. The merchant sees a small "Updated to v1.X" toast on launch.

No forced reload mid-session. No download progress UI.

---

## 8. Out of scope for this spec

Anything not listed above. See `NON_GOALS.md`. The most important non-goals are: multi-device sync, cloud backup, customer database, employee accounts, automated alerts, AI photo recognition, multi-store, payment processing, invoice printing.
