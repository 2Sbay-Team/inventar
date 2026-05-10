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
//
// v0.5 (ADR-017): merged the legacy 'kiosk' and 'grocery' archetypes into
// a single 'shop' archetype. Sub-categorisation is captured separately in
// `ShopProfile.shop_subtypes` (multi-select). Splitting the two added no
// functional difference and forced the merchant to misclassify themselves
// at onboarding (most small minimarkets sell both).
export type StoreType = 'shoes' | 'clothes' | 'shop';

// Multi-select sub-categorisation for the shop vertical. v0.5 ADR-017:
// the sub-types determine which default category list shows up in Add
// Article and shape the dashboard widgets (e.g. expiry warnings only
// matter for stores that sell food / cosmetics / vitamins). The merchant
// can pick any combination at onboarding and edit later in Settings.
export type ShopSubtype =
  | 'food_beverages'
  | 'tobacco_lottery'
  | 'snacks_confectionery'
  | 'personal_care'
  | 'household_cleaning'
  | 'parapharmaceutique'
  | 'stationery'
  | 'other';

// ADR-012 (v0.3): Movements carry a location for stock kept on the shop
// floor vs in the back room. Transfers move stock between the two.
export type Location = 'floor' | 'back';

// ADR-012 extends the v1 set with 'transfer' (between locations within a
// variant) and 'damage' (write-off without revenue impact).
export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer' | 'damage';

// v0.5 ADR-017: the eight canonical shop sub-types. Source of truth lives
// in config/shop-subtypes.ts; this is the type union the storage layer
// uses for `ShopProfile.shop_subtypes`.
export const SHOP_SUBTYPES: readonly ShopSubtype[] = [
  'food_beverages',
  'tobacco_lottery',
  'snacks_confectionery',
  'personal_care',
  'household_cleaning',
  'parapharmaceutique',
  'stationery',
  'other',
] as const;

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
  // v0.5 ADR-017: multi-select sub-categorisation, only meaningful when
  // store_type='shop'. Always an array; empty for non-shop verticals.
  // The migration v6→v7 maps legacy kiosk → ['tobacco_lottery',
  // 'snacks_confectionery'] and grocery → ['food_beverages']; merchants
  // can edit on first launch.
  shop_subtypes: ShopSubtype[];
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
  // v0.5 ADR-017: factory EAN-13 / UPC. Indexed for fast scanner lookup.
  // Null for items without a barcode (fresh produce, bread, in-house
  // products). Free-form string at the storage layer — the input
  // boundary in /receive validates EAN-13 checksum.
  barcode_ean: string | null;
  // v0.5 ADR-017: optional reorder threshold. When current stock drops
  // below this number, search/list show a "Low (N left)" badge and the
  // dashboard's "Items running low" widget counts this article. Null =
  // disabled. Stock units are integer (one per Variant), so this is too.
  min_stock_threshold: number | null;
  search_blob: string;
  updated_at: ISODate;
  archived_at: ISODate | null;
  deleted_at: ISODate | null;
}

export interface Variant {
  id: UUID;
  article_id: UUID;
  // Colour label — required for store_types where has_colors=true (shoes,
  // clothes), null for store_types where has_colors=false (shop).
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
  // v0.5 ADR-018: groups movements created in a single /receive or /sell
  // session. Same UUID across every Movement of one transaction so the
  // dashboard can count "transactions" (sales sessions, not units sold)
  // and the activity feed can collapse one cart of 5 items into a single
  // expandable row. Indexed. Null for movements created via the legacy
  // single-row paths (Quick Adjust, Add Article seed).
  transaction_id: UUID | null;
  // v0.5 ADR-019: expiry date stamped on the lot at receiving time. Set
  // on type='purchase' movements when the merchant entered an expiry in
  // the /receive bottom sheet. Null for non-perishable items and for
  // every non-purchase movement type. Indexed for the daily expiry sweep.
  expires_at: ISODate | null;
  // v0.5 ADR-019: FIFO attribution for sales of items that have lots.
  // Set on type='sale' movements when /sell resolves to a variant with at
  // least one Lot — the sale is attributed to the lot with the earliest
  // expires_at that still has remaining quantity. Null for non-perishable
  // items, for sales recorded before lots existed, and for non-sale types.
  lot_id: UUID | null;
  created_at: ISODate;
  deleted_at: ISODate | null;
}

// v0.5 ADR-019: a Lot is a single batch of one Variant received in one
// /receive session, with one expires_at value. Lots are created
// automatically by the receiving flow whenever the merchant enters an
// expiry; non-perishable items never produce Lot rows.
//
// Lot.remaining_quantity is NOT stored — it is computed as
// `original_quantity - SUM(sale movements where lot_id = this.id)`.
// This keeps Lot append-only and follows the Movement-as-truth principle
// (ADR-002).
export interface Lot {
  id: UUID;
  variant_id: UUID;
  // The expiry date the merchant entered at receiving. Indexed (ascending)
  // so the FIFO query and the daily expiry sweep are O(log n).
  expires_at: ISODate;
  received_at: ISODate;
  original_quantity: number;
  // FK back to the Movement that created this Lot. Lets the audit trail
  // and the migration / backup paths reconstruct the receiving event.
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

export interface MetaRow {
  key: string;
  value: unknown;
}
