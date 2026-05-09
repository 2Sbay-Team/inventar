// JSON export format v1 — frozen historical shape. The v0.3 import path
// reads v1 files via this module + the migrate-v5-to-v6 kernel; the export
// path no longer emits v1 (see backup/format-v2.ts and backup/export.ts).
//
// Types here are intentionally defined inline rather than imported from
// `../types`, so future canonical-type changes (additions, renames, field
// removals) cannot silently invalidate the legacy reader. Adding a field
// to `Article` in `types/index.ts` should not require a corresponding
// edit here — and won't, because these types describe the v1 wire shape,
// not the current in-app shape.

import type {
  CurrencyCode,
  ExpenseCategory,
  Locale,
  RecurringPeriod,
  StoreType,
  UUID,
} from '../types';

export const FORMAT_V1 = 'inventar-export-v1' as const;

export interface ShopProfileV1 {
  id: 'singleton';
  name: string;
  locale: Locale;
  logo_photo_id: UUID | null;
  currency: CurrencyCode;
  store_type: StoreType;
  created_at: string;
  updated_at: string;
  last_backup_at: string | null;
}

export interface ArticleV1 {
  id: UUID;
  internal_code: string;
  name: string;
  photo_id: UUID | null;
  category: string;
  colors: string[];
  brand: string | null;
  cost_price_tnd: number;
  sale_price_tnd: number;
  notes: string | null;
  search_blob: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface VariantV1 {
  id: UUID;
  article_id: UUID;
  size: string | null;
  hidden: boolean;
  updated_at: string;
  deleted_at: string | null;
}

export interface MovementV1 {
  id: UUID;
  variant_id: UUID;
  delta: number;
  type: 'sale' | 'purchase' | 'adjustment' | 'return';
  note: string | null;
  unit_price_tnd: number | null;
  created_at: string;
  deleted_at: string | null;
}

export interface ExpenseV1 {
  id: UUID;
  category: ExpenseCategory;
  amount_tnd: number;
  note: string | null;
  at: string;
  recurring: RecurringPeriod;
  updated_at: string;
  deleted_at: string | null;
}

export interface PhotoExportV1 {
  id: UUID;
  blob_b64: string;
  width: number;
  height: number;
  bytes: number;
  mime: string;
  created_at: string;
  deleted_at: string | null;
}

export interface ExportRowsV1 {
  profile: ShopProfileV1[];
  articles: ArticleV1[];
  variants: VariantV1[];
  movements: MovementV1[];
  expenses: ExpenseV1[];
  photos: PhotoExportV1[];
}

export interface BackupV1 {
  format: typeof FORMAT_V1;
  exported_at: string;
  app_version: string;
  rows: ExportRowsV1;
  integrity_sha256: string;
}

// Photo export shape used by the legacy reader and the v2 reader alike —
// the on-the-wire JSON serialises Blob bytes as base64. Re-exported here
// because the import path needs both types in the same scope.
export type PhotoExport = PhotoExportV1;

export const ROW_TABLES_V1: readonly (keyof ExportRowsV1)[] = [
  'profile',
  'articles',
  'variants',
  'movements',
  'expenses',
  'photos',
] as const;
