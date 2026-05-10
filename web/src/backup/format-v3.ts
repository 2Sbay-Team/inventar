import type {
  Article,
  Expense,
  Invoice,
  Lot,
  Movement,
  Photo,
  ShopProfile,
  Variant,
} from '../types';

// JSON export format v3 — DATA_MODEL §8. Bumped from v2 by ADR-024
// (invoices) plus a follow-up: v2 silently dropped `lots` and the
// invoice-counter meta key on round-trip. v3 carries:
//   * lots — FIFO expiry tracking, present since Dexie v7 but never
//     exported. Restoring without lots breaks expiry-aware FIFO sale
//     attribution on imported data.
//   * invoices — issued Factures (ADR-024). Legally significant; must
//     survive a device migration unchanged.
//   * counter_invoice — the single meta entry needed to keep invoice
//     numbering monotonic after restore. Other meta keys (banner
//     dismissals, snooze state, etc.) are device-local UX state and
//     intentionally excluded.
//
// v2 imports remain accepted: lots/invoices default to [] and the
// counter is reconstructed from any imported invoice rows. v1 imports
// likewise. v0.5.2.3-and-earlier apps reading a v3 file fail with
// BackupFormatTooNewError on parse — same back-compat door as v1→v2.

export const FORMAT_V3 = 'inventar-export-v3' as const;

export interface PhotoExportV3 extends Omit<Photo, 'blob'> {
  blob_b64: string;
}

export interface ExportRowsV3 {
  profile: ShopProfile[];
  articles: Article[];
  variants: Variant[];
  movements: Movement[];
  expenses: Expense[];
  photos: PhotoExportV3[];
  lots: Lot[];
  invoices: Invoice[];
}

export interface BackupV3 {
  format: typeof FORMAT_V3;
  exported_at: string; // ISODate
  app_version: string;
  rows: ExportRowsV3;
  // The per-year invoice counter map (e.g. `{ '2026': 42 }`) snapshot
  // at export time. Restore replays it into meta.invoice_counter so
  // the next issued invoice number stays monotonic. Optional only to
  // keep the parser happy when reading a v3 file written before this
  // field existed (defensive — there's no such file in the wild yet).
  invoice_counter?: Record<string, number>;
  integrity_sha256: string;
}

export const ROW_TABLES_V3: readonly (keyof ExportRowsV3)[] = [
  'profile',
  'articles',
  'variants',
  'movements',
  'expenses',
  'photos',
  'lots',
  'invoices',
] as const;
