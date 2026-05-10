# Inventar — Data Model

Single source of truth for table shapes, types, and indexes. The app has only one database: IndexedDB on the user's device, accessed via Dexie. There is no server-side persistence.

---

## 1. Core principles

1. **UUID v4 client-generated for every primary key.** Even though there's no sync, UUIDs make backup/restore trivially merge-safe between exports from the same user (e.g. if they re-import an old backup over newer data).
2. **Movement-as-truth for quantities.** A Variant has no `quantity` column. Quantity is computed: `SUM(movements.delta WHERE variant_id = X AND deleted_at IS NULL)`. This was a load-bearing decision; see `DECISIONS.md` ADR-002. It also means the audit trail is automatic.
3. **Soft deletes via `deleted_at` and `archived_at`.** Hard deletes only for explicit user-confirmed mistakes (typed "DELETE" confirmation).
4. **Every row carries `updated_at` (ISO 8601 UTC).** Drives merge-on-import logic for restore.
5. **Money stored as integer millimes** (1 TND = 1000 millimes). Avoids floating-point arithmetic. See ADR-005.

---

## 2. TypeScript types (canonical)

The shape below reflects the v0.5 schema. v0.3 introduced colour-on-Variant
+ location-on-Movement (ADR-011/012); v0.5 added the shop fields, lots, and
transaction grouping (ADR-017/018/019). The authoritative file is
`src/types/index.ts`.

```ts
export type UUID = string;        // uuidv4()
export type ISODate = string;     // "2026-05-05T14:23:00.123Z"
export type Locale = 'fr' | 'ar' | 'en';
export type CurrencyCode = string;          // ISO 4217
export type Category = string;              // free-form

// v0.5 ADR-017 — kiosk + grocery merged into one 'shop' vertical.
export type StoreType = 'shoes' | 'clothes' | 'shop';

// v0.5 ADR-017 — multi-select sub-categorisation, only used when
// store_type === 'shop'. Drives Add Article's default category list.
export type ShopSubtype =
  | 'food_beverages' | 'tobacco_lottery' | 'snacks_confectionery'
  | 'personal_care'  | 'household_cleaning' | 'parapharmaceutique'
  | 'stationery'     | 'other';

// v0.3 ADR-012.
export type Location = 'floor' | 'back';

// v0.3 ADR-012 added 'transfer' + 'damage'.
export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer' | 'damage';

export type ExpenseCategory =
  | 'supplier_transport' | 'rent' | 'electricity'
  | 'internet' | 'packaging' | 'taxes' | 'other';

export type RecurringPeriod = 'none' | 'weekly' | 'monthly';

export interface ShopProfile {
  id: 'singleton';
  name: string;
  locale: Locale;
  logo_photo_id: UUID | null;
  currency: CurrencyCode;
  store_type: StoreType;
  // v0.5 ADR-017: empty array for non-shop verticals.
  shop_subtypes: ShopSubtype[];
  created_at: ISODate;
  updated_at: ISODate;
  last_backup_at: ISODate | null;
}

export interface Article {
  id: UUID;
  internal_code: string;
  name: string;
  photo_id: UUID | null;     // ADR-013: doubles as fallback when Variant.photo_id is null
  category: Category;
  // DEPRECATED v0.3: kept as a denormalised cache of unique
  // Variant.color values; readers should use the variants list.
  colors: string[];
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  // v0.5 ADR-017: factory EAN-13 / UPC. Indexed for /receive + /sell scanner lookup.
  barcode_ean: string | null;
  // v0.5 ADR-017: optional reorder threshold; drives the "Low (N left)" badge in
  // Search/List and the dashboard's Items-running-low widget.
  min_stock_threshold: number | null;
  search_blob: string;
  updated_at: ISODate;
  archived_at: ISODate | null;
  deleted_at: ISODate | null;
}

export interface Variant {
  id: UUID;
  article_id: UUID;
  // v0.3 ADR-011 — colour moved off Article. Null for sizeless / colourless verticals.
  color: string | null;
  size: string | null;
  photo_id: UUID | null;  // per-colour photo; falls back to Article.photo_id
  hidden: boolean;
  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface Movement {
  id: UUID;
  variant_id: UUID;
  delta: number;
  type: MovementType;
  note: string | null;
  // Per-unit price override (millimes); null = use article.sale_price_tnd.
  unit_price_tnd: number | null;
  // v0.3 ADR-012 location dimension.
  location: Location | null;
  transfer_from: Location | null;
  transfer_to: Location | null;
  // v0.5 ADR-018: groups movements created in one /receive or /sell session.
  transaction_id: UUID | null;
  // v0.5 ADR-019: ISO date stamped on type='purchase' movements with expiry.
  expires_at: ISODate | null;
  // v0.5 ADR-019: FIFO attribution on type='sale' movements.
  lot_id: UUID | null;
  created_at: ISODate;
  deleted_at: ISODate | null;
}

// v0.5 ADR-019: Lots track expiry-dated batches of one Variant.
// remaining_quantity is NOT stored — see §6 + §9.
export interface Lot {
  id: UUID;
  variant_id: UUID;
  expires_at: ISODate;
  received_at: ISODate;
  original_quantity: number;
  source_movement_id: UUID;
  deleted_at: ISODate | null;
}

export interface Expense {
  id: UUID;
  category: ExpenseCategory;
  amount_tnd: number;
  note: string | null;
  at: ISODate;
  recurring: RecurringPeriod;
  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface Photo {
  id: UUID;
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  created_at: ISODate;
  deleted_at: ISODate | null;
}
```

---

## 3. Dexie schema

The current schema is at version 7 (v0.5). The full version chain is in
`src/db/db.ts`; only the v7 stores are reproduced here.

```ts
this.version(7).stores({
  profile:   'id',
  articles:  'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
  variants:  'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
  movements: 'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at',
  expenses:  'id, category, at, deleted_at',
  photos:    'id, deleted_at',
  meta:      'key',
  lots:      'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
});
```

Key indexes explained:

- `articles.search_blob` — token-prefix search via `where('search_blob').startsWithIgnoreCase(token)` for each token in the user's query.
- `articles.barcode_ean` — v0.5 ADR-018: scanner lookup in /receive + /sell.
- `variants.[article_id+color+size]` — v0.3 ADR-011: per-(colour, size) cell lookup.
- `movements.[variant_id+created_at]` — compound, used for the activity feed.
- `movements.[variant_id+location+created_at]` — v0.3 ADR-012: per-location quantity scans.
- `movements.transaction_id` — v0.5 ADR-018: group movements created in one /receive or /sell session.
- `movements.expires_at` — v0.5 ADR-019: daily expiry sweep.
- `lots.[variant_id+expires_at]` — v0.5 ADR-019: FIFO query (earliest expiry first per variant).
- `lots.source_movement_id` — v0.5 ADR-019: back-reference to the purchase Movement that created the lot.

Note: `Movement.lot_id` is **not** indexed. `repos/lots.ts` queries scope
by `variant_id` and filter by `lot_id` in memory — see §9.

Note: the legacy `articles.*colors` multi-entry index was dropped in v6
when colour moved to Variant. Old `Article.colors[]` remains as a
denormalised cache for legacy reads but is no longer indexed.

---

## 4. Auto-generated `internal_code`

When a new article is added:

```ts
async function nextInternalCode(): Promise<string> {
  const lastArticle = await db.articles
    .orderBy('internal_code')
    .reverse()
    .first();
  if (!lastArticle) return 'SH-0001';
  const n = parseInt(lastArticle.internal_code.split('-')[1], 10);
  return `SH-${String(n + 1).padStart(4, '0')}`;
}
```

Format: `SH-NNNN` where NNNN is zero-padded to 4 digits. Increments globally across the user's whole catalogue. Never reused even after deletion.

---

## 5. Search index (`search_blob`)

Recomputed deterministically on every article create/update:

```ts
function computeSearchBlob(a: Article): string {
  const tokens = [
    a.name,
    a.internal_code,
    a.brand ?? '',
    ...a.colors,
    a.category,
    a.notes ?? '',
  ].join(' ');
  return stripDiacritics(tokens).toLowerCase();
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
```

For Arabic digits, a separate normalisation runs before indexing AND on user input:

```ts
function normaliseDigits(s: string): string {
  return s.replace(/[\u0660-\u0669]/g, (d) =>
    String(d.charCodeAt(0) - 0x0660)
  );
}
```

This is what allows `أبيض ٤٢` and `white 42` to find the same row.

Variants are not in `search_blob` directly. Size matching is done via a join: `articles WHERE id IN (SELECT article_id FROM variants WHERE size = '42')`.

---

## 6. Quantity computation

```ts
async function quantityFor(variantId: string): Promise<number> {
  const movements = await db.movements
    .where('variant_id').equals(variantId)
    .and(m => m.deleted_at === null)
    .toArray();
  return movements.reduce((sum, m) => sum + m.delta, 0);
}

async function sizeGridFor(articleId: string): Promise<Array<{size: string, qty: number}>> {
  const variants = await db.variants
    .where('article_id').equals(articleId)
    .and(v => v.deleted_at === null && !v.hidden)
    .sortBy('size');

  return Promise.all(variants.map(async v => ({
    size: v.size,
    qty: await quantityFor(v.id),
  })));
}
```

This is fast because Dexie compound indexes make the per-variant movement scan O(log n + k) where k is the number of movements for that variant. At 100 movements per variant per year and 5 variants per article, the size grid for a typical article computes in well under 10 ms.

**v0.3 location split.** `quantityByLocation(variantId)` returns
`{floor, back}` by walking the same movements and applying location
rules (ADR-012): sale/purchase/return/adjustment/damage contribute to
`m.location`; transfer subtracts from `m.transfer_from` and adds to
`m.transfer_to`. `quantityFor(variantId)` returns floor + back so legacy
single-number callers stay correct.

**v0.5 lot remaining.** Lot.remaining_quantity is also derived:

```ts
remaining(lot) = lot.original_quantity
               - SUM(|m.delta|) for alive sale movements
                 with m.lot_id === lot.id
```

`lot_id` is not indexed (§3); `repos/lots.ts:remainingForLot` scopes the
movement query by the lot's `variant_id` (which IS indexed) and filters
by `lot_id` in memory. The inner set is bounded — one variant's
movements — so the filter is fast in practice.

---

## 7. Migrations strategy

- Dexie versioned migrations only. New `db.version(N)` block with `.upgrade(...)` callback.
- Backwards compatibility: schema changes that drop columns are forbidden in the first six months. Add new columns nullable; deprecate before dropping.
- Migration logic must be idempotent: a user opening an old version of the app, then a new version, then the old version again, must not corrupt data.

**Migration log.**

| From → To | Brief                                                                                 |
|-----------|---------------------------------------------------------------------------------------|
| v1 → v2   | `ShopProfile.logo_photo_id` (nullable, default null).                                 |
| v2 → v3   | `ShopProfile.currency` (default 'TND').                                               |
| v3 → v4   | `ShopProfile.store_type` (default 'shoes').                                           |
| v4 → v5   | `Movement.unit_price_tnd` (nullable, default null).                                   |
| v5 → v6   | v0.3 ADR-011/012: colour-on-Variant, location-on-Movement, fan-out per (color, size). |
| v6 → v7   | v0.5 ADR-017/018/019: kiosk+grocery → shop, shop_subtypes, barcode_ean,               |
|           | min_stock_threshold, transaction_id, expires_at, lot_id, new lots store.              |

The v6→v7 kernel is pure: read every legacy row, transform in memory,
write back. Kiosk profiles map to `store_type='shop'` with
`shop_subtypes=['tobacco_lottery','snacks_confectionery']`; grocery
profiles map with `shop_subtypes=['food_beverages']`. All other store
types pass through unchanged. Internal codes (KI-NNNN, GR-NNNN) are
preserved verbatim. No Lot rows are backfilled — only new /receive
sessions create Lots.

---

## 8. JSON export/import format

Export produces a single JSON object:

```json
{
  "format": "inventar-export-v1",
  "exported_at": "2026-05-05T14:23:00.000Z",
  "app_version": "1.0.0",
  "rows": {
    "profile":   [ {...} ],
    "articles":  [ {...}, {...} ],
    "variants":  [ {...}, {...} ],
    "movements": [ {...}, {...} ],
    "expenses":  [ {...}, {...} ],
    "photos":    [ { "id": "...", "blob_b64": "...", ... } ]
  },
  "integrity_sha256": "..."
}
```

Photos serialise to base64 inside the JSON for portability (no separate files). The `integrity_sha256` is a hash of `rows` (deterministic stringification, sorted keys). Import verifies the hash before applying.

Import modes:

- **Replace**: clear current IndexedDB, write imported rows.
- **Merge**: per-table, keep the row with the greater `updated_at`. For movements, append both copies (UUID prevents duplicates).

---

## 9. Lots & FIFO (v0.5 ADR-019)

A **Lot** is a single batch of one Variant received in one /receive
session, with one expiry date. Lots are created automatically when
the merchant enters an expiry on the receive bottom sheet; non-
perishable items never produce Lot rows. The Lot's
`source_movement_id` links back to the purchase Movement that created
it; if that purchase is later reverted (tombstoned), the Lot stays
but its `remaining` recomputes naturally because no sales were ever
attributed to it.

**Sale attribution.** /sell calls `pickFifoLot(variantId)` which
returns the alive lot with the earliest `expires_at` that still has
remaining stock, or null if the variant has no lots. The resulting
sale Movement carries `lot_id = pickedLot.id` (or null for non-
perishable items / sales recorded before lots existed / Quick Adjust
sales the merchant directs at a specific lot via the not-yet-shipped
manual override path).

**Damage / write-off.** /expiry's "Mark damaged" action writes a
damage Movement for the lot's full remaining quantity (location='floor',
note carries the expiry date) then `softDeleteLot(lotId)`. Other lots
of the same variant keep their FIFO position. The variant's overall
stock decreases by exactly the damaged amount.

**Snooze.** /expiry's "Hide for 7 days" stamps an
`expiry_snooze_${variantId}` meta key with `(now + 7d).iso`. The
Search-screen banner and the dashboard's Expiring-soon widget filter
out variants whose snooze is in the future. The /expiry list itself
shows snoozed rows dimmed (still actionable).

**Indexes.** See §3. The compound `[variant_id+expires_at]` powers
the FIFO query. `expires_at` alone supports the daily expiry sweep
across all variants. `Movement.lot_id` is **not** indexed —
`remainingForLot` scopes by `variant_id` (which IS indexed) and
filters by `lot_id` in memory. The original commit-1 reasoning that
"lot queries are always single-lot scoped" turned out to be wrong
because `pickFifoLot` iterates lots calling `remainingForLot`; the
fix landed in commit 4 and is now the canonical pattern.
