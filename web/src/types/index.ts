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
// `ShopProfile.shop_subtypes` (multi-select).
//
// v0.5.2 (ADR-021): merged 'shoes' and 'clothes' into 'fashion'. The
// shoes/clothes types stay in the union for one release as legacy values
// — existing pre-v9 profiles read here before the v8→v9 migration writes
// 'fashion'. STORE_TYPES still has entries for shoes and clothes to keep
// runtime reads safe across the upgrade. Both are removed in v0.7+.
export type StoreType = 'fashion' | 'shop' | 'shoes' | 'clothes';

// v0.5.6 — extended from the v0.5.2.9 piece/kg/g/l/ml union with
// three countable units (pair, pack, dozen) and meter for fabric.
// See web/src/config/article-traits.ts for the conversion factors and
// formatter. Article.unit_of_measure stores the literal string; the
// type just constrains what new code can write.
export type Uom = 'piece' | 'pair' | 'pack' | 'dozen' | 'kg' | 'g' | 'l' | 'ml' | 'meter';

// Multi-select sub-categorisation for the shop vertical. v0.5 ADR-017:
// the sub-types determine which default category list shows up in Add
// Article and shape the dashboard widgets. v0.5.2 ADR-018 expands the
// list to 14 predefined keys and allows free-form custom strings.
//
// `ShopSubtype` is a string type at the storage boundary so custom
// merchant labels (e.g. "tabac", "halal_meat") round-trip cleanly.
// `SHOP_SUBTYPES_PREDEFINED` enumerates the picker's predefined options.
// The two legacy keys 'tobacco_lottery' and 'parapharmaceutique' are
// preserved for back-compat (existing profiles keep them) but are NOT
// offered in the new picker — see config/shop-subtypes.ts.
export type ShopSubtype = string;

export type ShopSubtypePredefined =
  | 'food_beverages'
  | 'fresh_produce'
  | 'bakery_pastry'
  | 'snacks_confectionery'
  | 'frozen_foods'
  | 'personal_care'
  | 'cosmetics_beauty'
  | 'health_otc'
  | 'household_cleaning'
  | 'kitchenware_homegoods'
  | 'stationery'
  | 'toys_baby'
  | 'pet_supplies'
  | 'electronics_accessories';

// v0.5.2 ADR-021: legacy keys preserved for existing-profile back-compat.
// Not in the predefined picker; treated like custom strings in display.
export type ShopSubtypeLegacy = 'tobacco_lottery' | 'parapharmaceutique' | 'other';

// v0.5.2 ADR-021: fashion-vertical multi-select sub-categorisation.
// Same shape as shop: storage type is string (custom strings allowed),
// `FASHION_SUBTYPES_PREDEFINED` enumerates the predefined picker options.
export type FashionSubtype = string;

export type FashionSubtypePredefined =
  | 'shoes'
  | 'shoes_kids'
  | 'clothing_men'
  | 'clothing_women'
  | 'clothing_kids'
  | 'accessories'
  | 'bags'
  | 'jewelry';

// ADR-012 (v0.3): Movements carry a location for stock kept on the shop
// floor vs in the back room. Transfers move stock between the two.
export type Location = 'floor' | 'back';

// ADR-012 extends the v1 set with 'transfer' (between locations within a
// variant) and 'damage' (write-off without revenue impact).
export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return' | 'transfer' | 'damage';

// v0.5.2 ADR-018: the 14 canonical shop sub-types offered in the picker.
// Source of truth lives in config/shop-subtypes.ts. The array element
// type is the strict ShopSubtypePredefined so the picker UI can pattern-
// match exhaustively while ShopProfile.shop_subtypes stays a string[]
// (allowing custom + legacy values to round-trip).
//
// Order matters: this is the order the picker renders the chips.
export const SHOP_SUBTYPES_PREDEFINED: readonly ShopSubtypePredefined[] = [
  'food_beverages',
  'fresh_produce',
  'bakery_pastry',
  'snacks_confectionery',
  'frozen_foods',
  'personal_care',
  'cosmetics_beauty',
  'health_otc',
  'household_cleaning',
  'kitchenware_homegoods',
  'stationery',
  'toys_baby',
  'pet_supplies',
  'electronics_accessories',
] as const;

// v0.5 ADR-017 alias retained for callers that still import SHOP_SUBTYPES.
// Will be removed in v0.7+ along with the legacy ShopSubtypeLegacy keys.
export const SHOP_SUBTYPES: readonly ShopSubtype[] = SHOP_SUBTYPES_PREDEFINED;

// v0.5.2 ADR-021: the 8 canonical fashion sub-types offered in the picker.
// Source of truth lives in config/fashion-subtypes.ts.
export const FASHION_SUBTYPES_PREDEFINED: readonly FashionSubtypePredefined[] = [
  'shoes',
  'shoes_kids',
  'clothing_men',
  'clothing_women',
  'clothing_kids',
  'accessories',
  'bags',
  'jewelry',
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

// Size-numbering standard the merchant uses when stocking sized
// articles (shoes, women's clothing, jewelry, …). Drives which numeric
// chips Add Article surfaces — a EU/US/UK switch on shoes turns 36–46
// into 6–13 / 3–12 respectively. Default 'EU' for new and migrated
// profiles. Letter sizes (XS–XXXL) and age sizes (3M–16Y) ignore this.
export type SizeStandard = 'EU' | 'US' | 'UK' | 'JP';

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
  // v0.5.2 ADR-021: fashion-vertical analogue of shop_subtypes. Always
  // an array; empty for non-fashion verticals. The v8→v9 migration maps
  // legacy shoes → ['shoes'] and clothes → ['clothing_men',
  // 'clothing_women']; merchants confirm via the migration banner.
  fashion_subtypes: FashionSubtype[];
  // Size-numbering standard for sized articles (shoes, women's clothing,
  // rings). Default 'EU' — backfilled by the v15→v16 migration on
  // existing rows. Only narrows numeric chips; letter / age sizes are
  // identical across standards.
  size_standard: SizeStandard;
  // v0.5.2 ADR-022: merchant-customisable label for the front / display
  // zone (e.g. "Boutique", "Rayon", "Shop floor"). Internal Movement.
  // location enum stays 'floor' / 'back' for storage and indexing —
  // this is purely a display alias. Locale-aware defaults applied at
  // onboarding and during the v8→v9 migration. Required (no null) so
  // every render call site can read it without a fallback dance.
  location_floor_label: string;
  // v0.5.2 ADR-022: companion to location_floor_label for the back /
  // storage zone (e.g. "Réserve", "Stockroom", "المخزن").
  location_back_label: string;
  // v0.5.2 ADR-018 + ADR-023: global expiry warning threshold in days.
  // Used by the alerts banner + "expiring soon" tab when an article
  // doesn't override via Article.expiry_alert_days. Default 7 at onboarding;
  // migration copies the pre-v9 meta key `expiry_threshold_days` value
  // here for back-compat.
  expiry_warning_days: number;
  // v0.5.2.4 — invoicing / Facture fields. All nullable; populated via
  // Settings only when the merchant actually issues invoices. Kept on
  // the singleton profile so a v10 migration doesn't need a separate
  // table just for these four columns. legal_name is distinct from
  // `name` (which is the display label across the app) — many shops
  // trade as one name and bill as another (sole proprietor, SARL, etc).
  legal_name: string | null;
  // Multi-line free-form address; displayed verbatim on invoices.
  legal_address: string | null;
  // Tax / fiscal registration number — matricule fiscal (TN), SIRET
  // (FR), Steuernummer (DE), etc. Free string; we don't validate the
  // format because it varies per country and the merchant copies it
  // from their own paperwork.
  fiscal_id: string | null;
  // Default VAT rate as integer percent (e.g. 19 for Tunisia, 20 for
  // France). Used to pre-fill new invoices; the merchant can override
  // per-invoice. Null = no default; the invoice form falls back to 0.
  default_vat_pct: number | null;
  // v0.5.2.7 — merchant phone number. Optional. Printed on every
  // invoice under the address block. Stored verbatim (country code,
  // formatting, slashes, dashes, etc. all preserved) — we don't
  // validate the format because phone-number conventions vary widely
  // by country and the merchant copies it from their own paperwork.
  phone: string | null;
  // v0.6.5 — what to overlay in the centre of printed QR labels.
  // 'logo' = render logo_photo_id (auto-falls back to 'name' if the
  // logo has been deleted since this was set); 'name' = render the
  // shop's display name as styled text. Backfilled by the v13→v14
  // migration: 'logo' when logo_photo_id is set at upgrade time,
  // 'name' otherwise. Stored even when no logo exists so the picker
  // in Settings has a deterministic initial state.
  qr_center_mode: 'logo' | 'name';
  // v0.9 ADR-039 — Shop Identity expansion. All new fields are nullable
  // and default to null at first-create so pre-v0.9 profiles continue
  // to read without surprises. The v14→v15 migration backfills null on
  // every existing row. Three of these need narration:
  //
  //   * fiscal_id (already exists, v10) is reused as the UI's "Tax ID"
  //     label — see Settings → Business. We don't add a separate
  //     `tax_id` column because the brief's matricule fiscal / VAT /
  //     SIRET semantics are exactly what fiscal_id already stores.
  //   * legal_address (already exists, v10) stays the source of truth
  //     for the invoice-print address block — frozen multi-line string
  //     to keep historical invoices visually identical. The new
  //     `address_street` / `address_city` / `address_country` fields
  //     are for the catalog page and the digital business card; UI
  //     will offer to keep both in sync once both are filled.
  //   * logo_dominant_color: cached output of the canvas-based colour
  //     extractor (ADR-042). null until the merchant uploads a logo
  //     that survives the extractor's saturation + luminance filters.
  tagline: string | null;
  description: string | null;
  address_street: string | null;
  address_city: string | null;
  address_country: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  tiktok: string | null;
  // v0.9 ADR-040 — brand color (replaces the hard-coded #FF6B35
  // accent at render time when set). null = use the app's built-in
  // accent. Stored as a 7-char hex string `#RRGGBB`.
  brand_primary_color: string | null;
  // v0.9 ADR-040 — theme background colour, also `#RRGGBB`.
  // null = use the built-in Cream default. Phase 2 renders this; Phase
  // 1 just lands the field on the schema.
  theme_bg_color: string | null;
  theme_mode: ThemeMode;
  logo_dominant_color: string | null;
  opening_hours: OpeningHours | null;
  // v1.0 — Workflow: when true, /article/:id auto-redirects to the
  // sell flow when opened via in-app QR scan (location.state.fromQrScan).
  // Default null/false — customers scanning shelf QR codes expect
  // product info, not a sell screen.
  scan_qr_opens_sell?: boolean | null;
  // v1.1 — Label printing preferences. Nullable; defaults to 'both' / 'sheet_3x4'
  // when null. Persisted so the merchant's last choice becomes the new default.
  label_mode?: 'both' | 'qr_only' | 'barcode_only' | null;
  label_layout?: 'sheet_3x4' | 'sheet_2x5' | 'sheet_4x6' | null;
  created_at: ISODate;
  updated_at: ISODate;
  last_backup_at: ISODate | null;
}

export type QrCenterMode = 'logo' | 'name';

// v0.9 ADR-039 — Shop Identity expansion. Theme mode picker for the
// app appearance: 'light' (default), 'dark' (manual override), or
// 'auto' (follow system preference). Phase 2 only renders 'light';
// 'dark' / 'auto' are persisted but visually no-op until a later
// release wires real dark-mode coverage across every component.
export type ThemeMode = 'light' | 'dark' | 'auto';

// v0.9 ADR-041 — per-article tax category. See Article.tax_category
// for the field-level narration. Exported separately so the Add /
// Edit Article forms can iterate over the radio options without
// recreating the literal union by hand.
export type TaxCategory = 'standard' | 'reduced' | 'zero' | 'custom';

// v0.9 ADR-041 — the percent the 'reduced' bucket resolves to.
// Tunisia's secondary VAT band is 7% (rate for cultural / basic
// foodstuffs); we anchor it here so the resolver + the Add form
// label stay in sync. A later release can make this configurable
// per-shop (ShopProfile.reduced_vat_pct); for now it's a constant.
export const REDUCED_VAT_PCT_DEFAULT = 7 as const;

// v0.9 ADR-039 — per-day opening hours. `open: false` means the shop
// is closed that day and the from/to strings are ignored by the
// renderer (we keep them stored so the merchant can toggle a day
// closed and back without losing their previously-set hours).
// `from` / `to` are "HH:MM" 24h in the shop's local time — no
// timezone field since merchants always operate in one timezone.
export interface DayHours {
  open: boolean;
  from: string;
  to: string;
}

// v0.9 ADR-039 — week of opening hours. Each day is independently
// nullable: `null` means "the merchant hasn't configured this day
// yet" so the catalog / business-card display falls back to a
// neutral "hours not set" rather than rendering an inferred guess.
// The whole `opening_hours` field on ShopProfile is itself nullable
// — null = the merchant hasn't opened the Hours subsection at all.
export interface OpeningHours {
  monday: DayHours | null;
  tuesday: DayHours | null;
  wednesday: DayHours | null;
  thursday: DayHours | null;
  friday: DayHours | null;
  saturday: DayHours | null;
  sunday: DayHours | null;
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
  // v0.5.2 ADR-023: per-article expiry-alert threshold in days. When
  // set, the /alerts "Expiring soon" evaluation uses this article-
  // specific value instead of ShopProfile.expiry_warning_days. Null =
  // fall back to the profile default. Only meaningful for shop articles
  // with at least one Lot; ignored for fashion articles (which have no
  // expiry).
  expiry_alert_days: number | null;
  // v0.5.2.9 (Phase B) — per-article trait overrides. Null = follow
  // the store_type default (back-compat — every pre-v12 article reads
  // as null). A concrete true/false overrides at the article level so
  // a fashion-vertical merchant can add a single-SKU expiry-tracked
  // drink (has_sizes=false, has_colors=false, has_expiry=true), and a
  // shop-vertical merchant can add a sized T-shirt (has_sizes=true).
  has_sizes: boolean | null;
  has_colors: boolean | null;
  has_expiry: boolean | null;
  // v0.5.2.9 (UoM) — display + input precision. Internal storage of
  // Movement.delta + Variant qty stays integer in the *smallest* unit
  // (grams for kg/g, ml for l/ml, pieces for piece), so the existing
  // `|delta| * sale_price_tnd` revenue math is unchanged. Article.
  // sale_price_tnd is millimes per smallest unit — UI converts to/from
  // the merchant's preferred display unit (per-kg, per-l, …) at the
  // edit + read boundaries.
  unit_of_measure: Uom;
  // v0.9 ADR-041 — per-article tax category. Null = follow the shop's
  // ShopProfile.default_vat_pct at read time (the resolution boundary
  // is `getTaxRate(article, profile)` in utils/tax-rate.ts). Concrete
  // values let merchants flag a single SKU as zero-rated (medical
  // supplies, books in some markets), as the "reduced" bucket
  // (cultural goods, basic foodstuffs in EU regimes), or as 'custom'
  // when neither preset fits — `tax_custom_rate` carries the percent
  // for the 'custom' case and is null for every other value.
  // 'standard' is semantically equivalent to null today (both resolve
  // to the shop default), but keeping it as a distinct value lets the
  // merchant *explicitly* anchor an article to "always whatever the
  // shop standard is" — useful when later UX adds article-level
  // overrides that we don't want to silently swallow a null into.
  tax_category: 'standard' | 'reduced' | 'zero' | 'custom' | null;
  // Whole-percent override, only meaningful when tax_category =
  // 'custom'. Validated at the input boundary (0..100 integer).
  tax_custom_rate: number | null;
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
  // v0.5.1 (post-v0.5 follow-up): on type='return' movements, points at
  // the original sale Movement being refunded. Null when the merchant
  // returns an item that has no traceable sale (legacy data, manual
  // restock that doubled as a return, etc.). Lets us:
  //   1. Default the refund unit_price to the original sale's price
  //      (not the current catalogue price, which may have drifted).
  //   2. Credit the returned unit back to the lot the sale depleted —
  //      remainingForLot adds returns whose linked sale carried lot_id.
  // Indexed so "find returns of this sale" runs at O(log n).
  refunds_movement_id: UUID | null;
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
  // v0.5.2.2: storage type widened from `Blob` to `Blob | Uint8Array`.
  // Webkit / iOS Safari rejects Blobs returned by canvas.toBlob() /
  // browser-image-compression with "Error preparing Blob/File data to
  // be stored in object store". The storage layer now writes
  // Uint8Array (bytes) and reconstructs a Blob on read via the
  // photoToBlob() helper. Legacy rows written as Blob still read
  // back correctly — readers must use photoToBlob() or check both
  // shapes.
  blob: Blob | Uint8Array;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  created_at: ISODate;
  deleted_at: ISODate | null;
}

// v1.1 — Customer Master. Optional buyer records used by invoices,
// unpaid/partial payment follow-up, and repeat-customer sales. Walk-in
// sales do not need a Customer row; formal invoices and customer debt do.
export type CustomerType = 'individual' | 'company';

export interface Customer {
  id: UUID;
  type: CustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  fiscal_id: string | null;
  notes: string | null;
  search_blob: string;
  created_at: ISODate;
  updated_at: ISODate;
  deleted_at: ISODate | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

// v1.2 — structured invoice payment state. The stored status captures
// what was true at issue / last payment time; readers may derive
// `overdue` dynamically from due_at + balance_due_minor without mutating
// historical rows.
export type InvoicePaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'refunded';

// v0.5.2.4 ADR-024 — issued invoice / Facture. Snapshot rows: every
// numeric and label is frozen at issue time so an invoice stays
// identical even after the underlying article price or shop name
// changes. transaction_id (when set) ties it back to the /sell run
// that produced it; null when the merchant generates an invoice
// outside the sell flow (manual entry).
export interface InvoiceLine {
  // Free-form description; usually copied from Article.name at issue.
  // Stored verbatim so an article rename doesn't mutate old invoices.
  description: string;
  // Optional reference (article internal_code, EAN, etc). Display only.
  reference: string | null;
  // Stored in the article's smallest unit at the time of issue
  // (pieces for piece, grams for kg/g, ml for l/ml). Combined with
  // `unit_of_measure` below, the renderer formats it for display:
  // qty=850 + uom='kg' → "0.85 kg" / "850 g".
  qty: number;
  // Per-unit price in minor units of the invoice's currency
  // (millimes for TND, cents for EUR). Matches the rest of the
  // money-as-integer convention — see ADR-005.
  // For non-piece UoM this is per-smallest-unit (per gram / per ml)
  // so `qty * unit_price_minor` stays in millimes for ALL UoMs and
  // the existing subtotal math is unchanged.
  unit_price_minor: number;
  // v0.5.2.9 — snapshot of the article's UoM at issue time. Optional
  // for back-compat with invoices issued before this field landed;
  // missing/null reads as 'piece' (the historical default).
  unit_of_measure?: Uom;
}

export interface Invoice {
  id: UUID;
  // Sequential, format `INV-{YYYY}-{NNNN}` — guaranteed unique. The
  // counter lives in meta (META_KEYS.invoice_counter) and resets per
  // calendar year so the human-readable number stays short.
  number: string;
  issued_at: ISODate;
  // Customer block — all optional. A walk-in cash sale invoice may
  // have none of these set; a B2B invoice typically has all three.
  // customer_id links to Customer Master when one was chosen. The
  // printed buyer fields below remain snapshots so later edits to the
  // Customer row never rewrite old invoices.
  customer_id: UUID | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_fiscal_id: string | null;
  lines: InvoiceLine[];
  currency: CurrencyCode;
  // Subtotal (sum of lines, pre-VAT) in minor units. Stored so we
  // don't have to recompute on every render and so partial-rounding
  // semantics stay frozen at issue time.
  subtotal_minor: number;
  // VAT rate snapshot (integer percent). Defaults to ShopProfile.
  // default_vat_pct at issue but the merchant may override per-invoice.
  vat_pct: number;
  vat_minor: number;
  // v0.5.2.7 — optional VAT switch. When `false`, the VAT line is
  // suppressed on both the screen view and the PDF: total = subtotal,
  // no "VAT (X%)" row prints. Older invoices (pre-v0.5.2.7) don't
  // store this field — read with `?? true` so the historical
  // behaviour (VAT always shown) is preserved on every existing row.
  vat_enabled?: boolean;
  total_minor: number;
  // v1.2 — structured payment/debt snapshot. paid_minor is the cash
  // actually received when the invoice is issued in the current v1
  // flow; balance_due_minor is the remaining customer debt. Future
  // payment-ledger rows can append later payments while preserving
  // these fields as the invoice-level cache.
  payment_status: InvoicePaymentStatus;
  paid_minor: number;
  balance_due_minor: number;
  // Null for paid invoices. For unpaid/partial invoices the first v1
  // UI uses a default 30-day due date so overdue dashboards can work
  // without asking small-shop merchants to fill an extra field.
  due_at: ISODate | null;
  notes: string | null;
  // Link back to the /sell transaction this invoice was generated from.
  // Null when the invoice was issued manually (no sale on record).
  transaction_id: UUID | null;
  created_at: ISODate;
  deleted_at: ISODate | null;
}
