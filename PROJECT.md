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
| Article | A model in the catalogue (one shoe model, one shirt design, etc.). Has many Variants. |
| Variant | One size + color combination of an Article. |
| Movement | An append-only event recording a stock change (sale, purchase, adjustment, return). Quantity is computed as `SUM(movements.delta)` for a variant — never stored. |
| Expense | A flat cost not tied to a specific article (delivery, rent, packaging). |
| LWW | Last-Writer-Wins. Conflict resolution for editable metadata fields if/when concurrent edits ever happen on the same device (rare). |
| Tombstone | A soft-delete marker (`deleted_at` timestamp). Hard deletes reserved for explicit user-confirmed mistakes. |
| PWA | Progressive Web App. Installable from a URL, runs offline after first install. |
| TND | Tunisian Dinar. The only currency in MVP. Stored as integer millimes (1 TND = 1000 millimes). |
| millimes | Subunit of TND. Stored as integers to avoid floating-point arithmetic on money. |
