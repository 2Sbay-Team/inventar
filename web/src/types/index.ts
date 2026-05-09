// Canonical domain types — see DATA_MODEL.md §2.
// All money fields are integer millimes (1 TND = 1000 millimes); ADR-005.
// Variant has no quantity field; quantity is SUM(movements.delta); ADR-002.

export type UUID = string;
export type ISODate = string;
export type Locale = 'fr' | 'ar' | 'en';
// ISO 4217 currency code (3 letters). Validated at the input boundary
// (currency picker) — we don't enumerate the full set in the type because
// Intl.supportedValuesOf changes between runtimes.
export type CurrencyCode = string;

// Free-form category string. The app suggests a per-store-type list of
// categories (see config/store-types.ts) but stores accept any string so
// migrations between store types don't have to rewrite article rows.
export type Category = string;

// Top-level shop archetype. Drives which categories the user sees, whether
// articles need sizes (Variant.size becomes optional for sizeless types),
// and which dashboard widgets are most relevant.
export type StoreType = 'shoes' | 'clothes' | 'kiosk' | 'grocery';

// ADR-012 (v0.3): Movements carry a location for stock kept on the shop
// floor vs in the back room. Transfers move stock between the two.
export type Location = 'floor' | 'back';

// ADR-012 extends the v1 set with 'transfer' (between locations within a
// variant) and 'damage' (write-off without revenue impact).
export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer' | 'damage';

export type ExpenseCategory =
  | 'supplier_transport'
  | 'rent'
  | 'electricity'
  | 'internet'
  | 'packaging'
  | 'taxes'
  | 'other';

export type RecurringPeriod = 'none' | 'weekly' | 'monthly';

export interface ShopProfile {
  id: 'singleton';
  name: string;
  locale: Locale;
  // FK into photos. Stored as a Photo row so the logo participates in the
  // standard backup/export flow alongside article photos.
  logo_photo_id: UUID | null;
  // ISO 4217. Money fields on Article/Expense store integer minor units of
  // this currency (the legacy `_tnd` suffix is historical and means "minor
  // units" — see ADR-005). Switching currency does NOT rescale stored values.
  currency: CurrencyCode;
  // What kind of shop. Drives category suggestions + whether articles
  // require sizes. Existing pre-multi-vertical installs default to 'shoes'.
  store_type: StoreType;
  created_at: ISODate;
  updated_at: ISODate;
  last_backup_at: ISODate | null;
}

export interface Article {
  id: UUID;
  internal_code: string;
  name: string;
  // The article-level photo. Per ADR-013 the same row also doubles as the
  // fallback when a colour-specific Variant.photo_id is null.
  photo_id: UUID | null;
  category: Category;
  // DEPRECATED v0.3: kept as a denormalised cache of unique Variant.color
  // values across the article so legacy reads (article-detail's subtitle
  // line, the search-blob composer prior to its rewrite) keep working
  // through the colour-on-Variant transition. Removed in commit 7 once
  // every reader has migrated to the variants list.
  colors: string[];
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  search_blob: string;
  updated_at: ISODate;
  archived_at: ISODate | null;
  deleted_at: ISODate | null;
}

export interface Variant {
  id: UUID;
  article_id: UUID;
  // Colour label — required for store_types where has_colors=true (shoes,
  // clothes), null for store_types where has_colors=false (kiosk, grocery).
  // Stored lowercase. ADR-011 moved this off Article so per-(colour, size)
  // stock counts are unambiguous.
  color: string | null;
  // Size label (e.g. "42", "XL"). Null for sizeless store types.
  size: string | null;
  // Per-colour photo. Null = fall back to Article.photo_id at render time.
  // The Add flow's "first colour" Variant.photo_id is also written to
  // Article.photo_id so single-colour and sizeless verticals carry one
  // photo through both pointers without duplication. ADR-013.
  photo_id: UUID | null;
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
  // Per-unit price override in minor units. Null means "use the
  // article's current sale_price_tnd" (the default for the vast
  // majority of sales). Set per-movement when a customer gets a
  // discount or pays a special price for THIS sale only — does NOT
  // change the article's catalogue price. Revenue computations should
  // read `unit_price_tnd ?? article.sale_price_tnd`.
  unit_price_tnd: number | null;
  // ADR-012: location dimension. Set for sale / purchase / return /
  // adjustment / damage movements. Null for transfers — those use
  // transfer_from / transfer_to instead.
  location: Location | null;
  // ADR-012: transfer endpoints. Both null for non-transfer types.
  // For type='transfer', delta is the absolute count moved (positive
  // integer); the per-location quantity computation deducts from
  // transfer_from and adds to transfer_to.
  transfer_from: Location | null;
  transfer_to: Location | null;
  created_at: ISODate;
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

export interface MetaRow {
  key: string;
  value: unknown;
}
