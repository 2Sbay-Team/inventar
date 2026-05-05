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

```ts
// src/types/index.ts — used everywhere in the app

export type UUID = string;        // uuidv4()
export type ISODate = string;     // "2026-05-05T14:23:00.123Z"
export type Locale = 'fr' | 'ar' | 'en';

export type Category =
  | 'sport' | 'dress' | 'casual'
  | 'kids'  | 'women' | 'men';

export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return';

export type ExpenseCategory =
  | 'supplier_transport' | 'rent' | 'electricity'
  | 'internet' | 'packaging' | 'taxes' | 'other';

export type RecurringPeriod = 'none' | 'weekly' | 'monthly';

export interface ShopProfile {
  id: 'singleton';        // there is exactly one row, fixed id
  name: string;
  locale: Locale;
  created_at: ISODate;
  updated_at: ISODate;
  last_backup_at: ISODate | null;
}

export interface Article {
  id: UUID;
  internal_code: string;   // "SH-0042", auto-generated
  name: string;
  photo_id: UUID | null;   // FK to Photo
  category: Category;
  colors: string[];        // free-form, lowercase
  brand: string | null;
  cost_price_tnd: number;  // millimes
  sale_price_tnd: number;  // millimes
  notes: string | null;

  search_blob: string;     // denormalised, lowercase, diacritics-stripped, for indexed search

  updated_at: ISODate;
  archived_at: ISODate | null;
  deleted_at: ISODate | null;
}

export interface Variant {
  id: UUID;
  article_id: UUID;
  size: string;            // "42", "M", "32x34" — alphanumeric
  hidden: boolean;         // cosmetic only, default false

  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface Movement {
  id: UUID;
  variant_id: UUID;
  delta: number;           // signed integer, non-zero
  type: MovementType;
  note: string | null;

  created_at: ISODate;     // immutable, set once
  deleted_at: ISODate | null;  // tombstone if reverted; never edited
}

export interface Expense {
  id: UUID;
  category: ExpenseCategory;
  amount_tnd: number;       // millimes
  note: string | null;
  at: ISODate;              // user-editable date
  recurring: RecurringPeriod;

  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface Photo {
  id: UUID;
  blob: Blob;               // compressed image data
  width: number;
  height: number;
  bytes: number;
  mime: string;             // typically "image/jpeg"

  created_at: ISODate;
  deleted_at: ISODate | null;
}
```

---

## 3. Dexie schema

```ts
// src/db/db.ts
import Dexie, { Table } from 'dexie';
import type { ShopProfile, Article, Variant, Movement, Expense, Photo } from '../types';

export class InventarDB extends Dexie {
  profile!:   Table<ShopProfile, string>;
  articles!:  Table<Article, string>;
  variants!:  Table<Variant, string>;
  movements!: Table<Movement, string>;
  expenses!:  Table<Expense, string>;
  photos!:    Table<Photo, string>;
  meta!:      Table<{ key: string; value: unknown }, string>;

  constructor() {
    super('inventar');
    this.version(1).stores({
      profile:   'id',
      articles:  'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
      variants:  'id, article_id, [article_id+size], deleted_at',
      movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
      expenses:  'id, category, at, deleted_at',
      photos:    'id, deleted_at',
      meta:      'key',
    });
  }
}

export const db = new InventarDB();
```

Key indexes explained:

- `articles.search_blob` — token-prefix search via `where('search_blob').startsWithIgnoreCase(token)` for each token in the user's query.
- `articles.*colors` — multi-entry index, allows `where('colors').equals('white')`.
- `variants.[article_id+size]` — compound, used for "do we have this size for this article" lookup.
- `movements.[variant_id+created_at]` — compound, used for the activity feed.

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

---

## 7. Migrations strategy

- Dexie versioned migrations only. New `db.version(N)` block with `.upgrade(...)` callback.
- Backwards compatibility: schema changes that drop columns are forbidden in the first six months. Add new columns nullable; deprecate before dropping.
- Migration logic must be idempotent: a user opening an old version of the app, then a new version, then the old version again, must not corrupt data.

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
