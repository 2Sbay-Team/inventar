import type { Article, Expense, Movement, Photo, ShopProfile, Variant } from '../types';

// JSON export format v1 — DATA_MODEL §8. Bumping this magic string is a
// breaking change. New optional fields go through a v2 with an upgrade path.

export const FORMAT_V1 = 'inventar-export-v1' as const;

export interface PhotoExport extends Omit<Photo, 'blob'> {
  blob_b64: string;
}

export interface ExportRowsV1 {
  profile: ShopProfile[];
  articles: Article[];
  variants: Variant[];
  movements: Movement[];
  expenses: Expense[];
  photos: PhotoExport[];
}

export interface BackupV1 {
  format: typeof FORMAT_V1;
  exported_at: string; // ISODate
  app_version: string;
  rows: ExportRowsV1;
  integrity_sha256: string;
}

export const ROW_TABLES: readonly (keyof ExportRowsV1)[] = [
  'profile',
  'articles',
  'variants',
  'movements',
  'expenses',
  'photos',
] as const;
