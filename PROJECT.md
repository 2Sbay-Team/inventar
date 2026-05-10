# Inventar

A pure-client PWA for inventory management on a single phone. No server database. No sync. No accounts. Works fully offline from the moment of install. Distributed by URL.

The first user is Naili, a shoe merchant in Sidi Bouzid, Tunisia. The same code installs for any other merchant who visits the URL. Each user's data lives entirely on their device — no cross-tenant concerns exist because there is no shared backend.

---

## The original problem

Naili runs his shop alone. He sometimes buys shoes from informal suppliers, so many items have no manufacturer SKU. He records them in a paper notebook. When customers call him at home, he cannot check his stock — the notebook is at the shop. He has lost sales because of this and is willing to use a phone-based tool if it works without his daily attention.

This product is shaped by that single constraint: **the merchant gets a useful answer in the time it takes to say "let me check"**.

---

## Architecture in one paragraph

A React + Vite + TypeScript Progressive Web App. All data persisted in IndexedDB via Dexie. Photos compressed to ≤ 200 KB and stored as Blobs in the same database. Service Worker caches the app shell with a stale-while-revalidate strategy so launches are instant and updates roll out silently. Three locales (FR default, AR with RTL and Eastern Arabic numerals, EN). Hosted as static files on the existing Hostinger VPS at `/opt/inventar/`, served by nginx, exposed via the existing Cloudflare Tunnel at `inventar.hoodhood.ai`. No application server. No database server. No authentication system.

---

## Roles

- **Code owner (Yousri Gammoudi)** — owns the repository, the VPS, and the Cloudflare account. Deploys static-file updates. Has no access to any user's data because no user data ever leaves the user's device.

- **End user (each merchant)** — installs the PWA from the URL, picks a language, types a shop name, starts using. Owns their data fully and locally. Can export to JSON anytime; can delete the app and lose everything.

The product has no other roles. There is no support tier with read access to user data. There is no admin dashboard with cross-user visibility. Privacy is enforced by architecture: the VPS literally does not know who has installed the app or what they put in it.

---

## Scope of MVP (v1.0)

The MVP delivers, in roughly one week of focused work:

1. **Inventory** — articles, variants by size, photos, stock movements (purchases, sales, adjustments, returns).
2. **Search** — fast offline lookup with mixed Arabic/French/English tolerance.
3. **Dashboard** — revenue, profit, expenses, top sellers, recent activity. Observational only.
4. **Three locales** — French (default), Arabic with RTL and Eastern numerals, English.
5. **Backup/restore** — JSON export to OS share sheet, JSON import from file picker.
6. **Offline-first** — IndexedDB primary and only store. Service Worker for app shell.

Everything else listed in `NON_GOALS.md` is deferred — most notably multi-device sync, cloud backup, and any concept of accounts.

---

## File map of this directory

```
PROJECT.md          ← you are here. context, roles, scope.
SPEC.md             ← user stories, screens, flows, validation, locales.
DATA_MODEL.md       ← TypeScript types and Dexie schema. Client only.
DECISIONS.md        ← ADRs explaining the load-bearing architectural choices.
NON_GOALS.md        ← explicit out-of-scope list. defends against scope creep.
DEPLOY.md           ← Docker, nginx, Cloudflare Tunnel, install instructions.
TESTING.md          ← Playwright E2E suite, stress tests, dry-run protocol.
first_prompt.md     ← the verbatim prompt to paste into Claude Code first.
ui_mockups/
  inventar_first_mockup.html  ← visual reference (Search / Article / Add).
```

Read in this order. Do not start coding before all eight files are read end-to-end.

---

## Glossary

| Term | Meaning |
|---|---|
| Article | A model in the catalogue (one shoe model, one shirt design, one packaged retail SKU). Has many Variants. |
| Variant | One (colour, size) combination of an Article. v0.3 ADR-011 moved colour off Article; v0.3 ADR-012 added a per-Movement floor / back location. Sizeless / colourless verticals (shop) keep one Variant per Article with both fields null. |
| Movement | An append-only event recording a stock change (sale, purchase, adjustment, return, transfer, damage). Quantity is computed as `SUM(movements.delta)` for a variant — never stored. |
| Lot | (v0.5 ADR-019) A single batch of one Variant received in one /receive session, with one expiry date. Lots are created automatically when the merchant enters an expiry. /sell auto-attributes the sale to the FIFO lot (earliest expires_at with remaining > 0). Lot.remaining is derived: `original_quantity − SUM(|delta|)` for sale movements with `lot_id = this.id`. |
| Transaction | (v0.5 ADR-018) A UUID stamped on every Movement created in one /receive or /sell session. Lets the activity feed collapse one cart of N items into a single expandable row. |
| Expense | A flat cost not tied to a specific article (delivery, rent, packaging). |
| Vertical / store_type | The shape of the catalogue. v0.5 ADR-017 merged kiosk + grocery → 'shop'. v0.5.2 ADR-021 merged shoes + clothes → 'fashion'. Two verticals: fashion (sized + coloured, browse-driven, sku_prefix=FN) and shop (scan-driven, expiry-aware, sku_prefix=SP). Each has its own multi-select sub-types (`fashion_subtypes` / `shop_subtypes`). |
| Fashion sub-type | (v0.5.2) Multi-select for the fashion vertical. 8 predefined: shoes, shoes_kids, clothing_men, clothing_women, clothing_kids, accessories, bags, jewelry. Custom merchant strings allowed (≤30 chars, stored verbatim). Drives Add Article's size-hint autocomplete + category list. |
| Shop sub-type | (v0.5 expanded in v0.5.2) Multi-select for the shop vertical. 14 predefined: food_beverages, fresh_produce, bakery_pastry, snacks_confectionery, frozen_foods, personal_care, cosmetics_beauty, health_otc, household_cleaning, kitchenware_homegoods, stationery, toys_baby, pet_supplies, electronics_accessories. Custom strings allowed. Legacy 'tobacco_lottery' / 'parapharmaceutique' / 'other' preserved for back-compat but not in the picker. Drives Add Article's category list, dashboard widgets, and /receive's expiry-input pre-focus. |
| Alert | (v0.5.2 ADR-018) An item in the consolidated /alerts screen. Two tabs: low-stock (per-article `min_stock_threshold` + current stock below) and expiring-soon (lots within `expiry_warning_days`, with per-article `expiry_alert_days` override). Aggregated count surfaces in the home-screen AlertsBanner. |
| Lot dropdown | (v0.5.2 ADR-020) Manual lot override in Quick Adjust. Visible when a shop variant has ≥2 alive lots with remaining > 0; lets the merchant attribute a sale or return to a specific batch instead of FIFO. |
| Location label | (v0.5.2 ADR-022) Merchant-customisable display string for the front/back stock zones. Internal `Movement.location` enum stays 'floor' / 'back' for storage; `useLocationLabels()` returns the merchant's labels for display. Defaults are locale + vertical-aware. |
| LWW | Last-Writer-Wins. Conflict resolution for editable metadata fields if/when concurrent edits ever happen on the same device (rare). |
| Tombstone | A soft-delete marker (`deleted_at` timestamp). Hard deletes reserved for explicit user-confirmed mistakes. |
| PWA | Progressive Web App. Installable from a URL, runs offline after first install. |
| TND | Tunisian Dinar. The default currency. Stored as integer millimes (1 TND = 1000 millimes). v0.4 added per-shop currency selection — the `_tnd` suffix on money fields is historical and now means "minor units of the shop's chosen currency". |
| millimes | Subunit of TND. Stored as integers to avoid floating-point arithmetic on money. |
