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

export type MovementType = 'sale' | 'purchase' | 'adjustment' | 'return';

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
  photo_id: UUID | null;
  category: Category;
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
  // Size label (e.g. "42", "XL"). Null for sizeless store types
  // (kiosk / grocery) — those articles get one default variant where
  // size is just a placeholder. See config/store-types.ts.
  size: string | null;
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
