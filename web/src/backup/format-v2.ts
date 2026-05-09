import type { Article, Expense, Movement, Photo, ShopProfile, Variant } from '../types';

// JSON export format v2 — DATA_MODEL §8. Bumped from v1 by ADR-011 / ADR-012
// to carry the new colour-on-Variant and location-on-Movement fields. v0.3
// imports accept BOTH v1 and v2 (v1 is transformed in-memory by the
// migrate-v5-to-v6 kernel before being applied). v1-era apps importing a
// v2 file fail with `BackupFormatTooNewError`.

export const FORMAT_V2 = 'inventar-export-v2' as const;

export interface PhotoExportV2 extends Omit<Photo, 'blob'> {
  blob_b64: string;
}

export interface ExportRowsV2 {
  profile: ShopProfile[];
  articles: Article[];
  variants: Variant[];
  movements: Movement[];
  expenses: Expense[];
  photos: PhotoExportV2[];
}

export interface BackupV2 {
  format: typeof FORMAT_V2;
  exported_at: string; // ISODate
  app_version: string;
  rows: ExportRowsV2;
  integrity_sha256: string;
}

export const ROW_TABLES_V2: readonly (keyof ExportRowsV2)[] = [
  'profile',
  'articles',
  'variants',
  'movements',
  'expenses',
  'photos',
] as const;
