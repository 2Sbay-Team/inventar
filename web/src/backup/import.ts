import { db as appDB, type InventarDB } from '../db/db';
import { migrateRowsV5ToV6 } from '../db/migrate-v5-to-v6';
import {
  migrateRowsV6ToV7,
  type V6Article,
  type V6Movement,
  type V6ShopProfile,
} from '../db/migrate-v6-to-v7';
import { migrateRowsV8ToV9 } from '../db/migrate-v8-to-v9';
import { setMeta, META_KEYS } from '../repos/meta';
import type { Article, Customer, Invoice, Lot, Movement, Photo, ShopProfile } from '../types';
import { FORMAT_V1, type BackupV1, type PhotoExport } from './format-v1';
import { FORMAT_V2, type BackupV2, type PhotoExportV2 } from './format-v2';
import { FORMAT_V3, type BackupV3, type ExportRowsV3, type PhotoExportV3 } from './format-v3';
import { integrityHash } from './integrity';

// SPEC §3 / DATA_MODEL §8: import accepts either a parsed object or a JSON
// string. We verify shape, then verify the integrity hash, then apply via
// either:
//   - replace: clear current IndexedDB tables, write imported rows
//   - merge:   per-table, keep the row with the greater updated_at
//             (movements: append both — UUID prevents duplicates)
//
// v0.3 (ADR-011 / ADR-012): the parser branches on the top-level `format`
// field. v1 files are read via format-v1.ts and run through the
// migrate-v5-to-v6 kernel in memory before the rows reach the apply path.
// v2 files are applied directly. Anything else is `BackupFormatTooNewError`,
// surfaced inline in Settings → Import Data so the user gets a clear
// "update the app" message rather than a generic parse failure.

export type ImportMode = 'replace' | 'merge';

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export class BackupIntegrityError extends Error {
  constructor() {
    super('integrity hash mismatch');
    this.name = 'BackupIntegrityError';
  }
}

export class BackupFormatTooNewError extends Error {
  constructor(format: string) {
    super(`Backup format too new — please update the app (${format})`);
    this.name = 'BackupFormatTooNewError';
  }
}

// Common applied-row shape — superset that covers v3, with v1/v2 inputs
// promoted to the same shape with empty arrays for the new tables. The
// applier doesn't need to know which branch produced its input.
type AppliedRows = ExportRowsV3;

export interface ImportSummary {
  inserted: Record<keyof AppliedRows, number>;
  updated: Record<keyof AppliedRows, number>;
  skipped: Record<keyof AppliedRows, number>;
}

function emptySummary(): ImportSummary {
  const z = (): Record<keyof AppliedRows, number> => ({
    profile: 0,
    articles: 0,
    variants: 0,
    movements: 0,
    expenses: 0,
    photos: 0,
    customers: 0,
    lots: 0,
    invoices: 0,
  });
  return { inserted: z(), updated: z(), skipped: z() };
}

export type ParsedBackup =
  | { kind: 'v3'; backup: BackupV3 }
  | { kind: 'v2'; backup: BackupV2 }
  | { kind: 'v1'; backup: BackupV1 };

export function parseBackup(input: string | unknown): ParsedBackup {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (err) {
      throw new BackupParseError(`invalid JSON: ${(err as Error).message}`);
    }
  } else {
    raw = input;
  }

  if (!raw || typeof raw !== 'object') {
    throw new BackupParseError('not an object');
  }
  const obj = raw as Record<string, unknown>;
  const format = obj.format;
  if (format !== FORMAT_V1 && format !== FORMAT_V2 && format !== FORMAT_V3) {
    if (typeof format === 'string' && format.startsWith('inventar-export-')) {
      throw new BackupFormatTooNewError(format);
    }
    throw new BackupParseError(`unknown format: ${String(format)}`);
  }
  if (typeof obj.integrity_sha256 !== 'string') {
    throw new BackupParseError('missing integrity_sha256');
  }
  if (!obj.rows || typeof obj.rows !== 'object') {
    throw new BackupParseError('missing rows');
  }
  const rows = obj.rows as Record<string, unknown>;
  for (const k of ['profile', 'articles', 'variants', 'movements', 'expenses', 'photos']) {
    if (!Array.isArray(rows[k])) {
      throw new BackupParseError(`rows.${k} must be an array`);
    }
  }
  // v3-only: lots + invoices arrays. v1/v2 imports stay accepted; the
  // applier promotes them to empty arrays.
  if (format === FORMAT_V3) {
    for (const k of ['lots', 'invoices']) {
      if (!Array.isArray(rows[k])) {
        throw new BackupParseError(`rows.${k} must be an array`);
      }
    }
    return { kind: 'v3', backup: obj as unknown as BackupV3 };
  }
  if (format === FORMAT_V2) {
    return { kind: 'v2', backup: obj as unknown as BackupV2 };
  }
  return { kind: 'v1', backup: obj as unknown as BackupV1 };
}

export async function verifyIntegrity(parsed: ParsedBackup): Promise<boolean> {
  const computed = await integrityHash(parsed.backup.rows);
  return computed === parsed.backup.integrity_sha256;
}

function rehydratePhoto(row: PhotoExport | PhotoExportV2 | PhotoExportV3): Photo {
  const { blob_b64, ...rest } = row;
  // v0.5.2.2: store as Uint8Array (not Blob) so the IDB write path is
  // identical to storePhoto's. Webkit refuses certain Blob shapes;
  // raw bytes always round-trip cleanly.
  const binary =
    typeof atob === 'function'
      ? atob(blob_b64)
      : Buffer.from(blob_b64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ...rest, blob: bytes };
}

// Translates a parsed v1 backup into the same row shape applyRows
// expects. Chains v5→v6 → v6→v7 → v8→v9 (v7→v8's only change is on
// movements, which we apply inline below). v0.5.2 ADR-021: the v8→v9
// chain ensures imported v1 backups land on the new fashion / shop
// vertical with all v9 profile + article fields populated.
function transformV1ToApplied(backup: BackupV1): AppliedRows {
  const profileV1 = backup.rows.profile[0] ?? null;
  const v6 = migrateRowsV5ToV6({
    profile: profileV1,
    articles: backup.rows.articles,
    variants: backup.rows.variants,
    movements: backup.rows.movements,
  }).rows;
  const v7 = migrateRowsV6ToV7({
    profile: profileV1 as V6ShopProfile | null,
    articles: v6.articles as V6Article[],
    movements: v6.movements as V6Movement[],
  }).rows;
  // v7→v8 inline: stamp refunds_movement_id null on every movement.
  const v8Movements = v7.movements.map((m) => ({
    ...m,
    refunds_movement_id: m.refunds_movement_id ?? null,
  }));
  // v8→v9: fashion / shop vertical consolidation + location labels +
  // expiry_warning_days + Article.expiry_alert_days. No meta value to
  // pass for expiry_threshold_days — backups didn't carry the meta
  // table in v1; the kernel's default 7 wins.
  const v9 = migrateRowsV8ToV9({
    profile: v7.profile,
    articles: v7.articles,
    expiryThresholdDaysMeta: null,
  }).rows;
  return {
    profile: v9.profile ? [v9.profile] : [],
    articles: v9.articles,
    variants: v6.variants,
    movements: v8Movements,
    expenses: backup.rows.expenses,
    customers: [],
    photos: backup.rows.photos,
    // v0.5.2.5: v1 backups predate both lots and invoices.
    lots: [],
    invoices: [],
  };
}

// v0.5: defensive backfill for v2 backups exported BEFORE the v0.5
// fields existed. We can't tell from the format-v2 envelope alone which
// shape the rows have inside, so we run every imported v2 row through a
// no-op upgrade that fills in null defaults on missing fields. Rows that
// already have the v0.5 fields pass through unchanged.
function backfillV05Defaults(rows: AppliedRows): AppliedRows {
  return {
    profile: rows.profile.map((p) => {
      const sp = p as ShopProfile;
      // v0.6.5: qr_center_mode landed in Dexie v14. v1/v2/v3 backups
      // exported before that don't carry the field. Backfill from
      // logo presence — matches the v13→v14 upgrade rule so imported
      // rows look identical to in-place-migrated rows.
      const qrMode: ShopProfile['qr_center_mode'] =
        sp.qr_center_mode === 'logo' || sp.qr_center_mode === 'name'
          ? sp.qr_center_mode
          : sp.logo_photo_id
            ? 'logo'
            : 'name';
      return {
        ...sp,
        shop_subtypes: (sp.shop_subtypes ?? []) as ShopProfile['shop_subtypes'],
        qr_center_mode: qrMode,
        // v0.9 ADR-039 / ADR-040: Shop Identity expansion. Backups
        // exported before v0.9 don't carry these 16 columns. The
        // `?? null` / `?? 'light'` defaults match the v14→v15 in-
        // place upgrade rules so imported rows look identical to
        // rows that flowed through the live migration.
        tagline: sp.tagline ?? null,
        description: sp.description ?? null,
        address_street: sp.address_street ?? null,
        address_city: sp.address_city ?? null,
        address_country: sp.address_country ?? null,
        whatsapp: sp.whatsapp ?? null,
        email: sp.email ?? null,
        website: sp.website ?? null,
        instagram: sp.instagram ?? null,
        facebook: sp.facebook ?? null,
        tiktok: sp.tiktok ?? null,
        brand_primary_color: sp.brand_primary_color ?? null,
        theme_bg_color: sp.theme_bg_color ?? null,
        theme_mode: sp.theme_mode ?? 'light',
        logo_dominant_color: sp.logo_dominant_color ?? null,
        opening_hours: sp.opening_hours ?? null,
      } as ShopProfile;
    }),
    articles: rows.articles.map(
      (a) =>
        ({
          ...a,
          barcode_ean: (a as Article).barcode_ean ?? null,
          min_stock_threshold: (a as Article).min_stock_threshold ?? null,
          // v0.5.2.9 (Phase B + UoM): older backups don't carry the
          // per-article trait overrides or unit_of_measure. Default
          // overrides to null (= follow store_type), unit_of_measure
          // to 'piece' so the existing |qty| * price math is
          // identical to pre-UoM behaviour.
          has_sizes: (a as Article).has_sizes ?? null,
          has_colors: (a as Article).has_colors ?? null,
          has_expiry: (a as Article).has_expiry ?? null,
          unit_of_measure: (a as Article).unit_of_measure ?? 'piece',
        }) as Article,
    ),
    variants: rows.variants,
    movements: rows.movements.map(
      (m) =>
        ({
          ...m,
          transaction_id: (m as Movement).transaction_id ?? null,
          expires_at: (m as Movement).expires_at ?? null,
          lot_id: (m as Movement).lot_id ?? null,
          // v0.5.1: Movement.refunds_movement_id added in Dexie v8.
          // Backfill defensively for backups exported before that.
          refunds_movement_id: (m as Movement).refunds_movement_id ?? null,
        }) as Movement,
    ),
    expenses: rows.expenses,
    customers: ((rows as unknown as { customers?: Customer[] }).customers ?? []) as Customer[],
    photos: rows.photos,
    // v0.5.2.5: v2 backups predate lots + invoices. v3 backups carry
    // them; this defensive backfill is a no-op when the input is v3.
    lots: ((rows as unknown as { lots?: Lot[] }).lots ?? []) as Lot[],
    invoices: (((rows as unknown as { invoices?: Invoice[] }).invoices ?? []) as Invoice[]).map(
      (invoice) => {
        const total = Math.max(0, Math.round(invoice.total_minor ?? 0));
        const paid = Math.max(0, Math.round(invoice.paid_minor ?? total));
        const cappedPaid = Math.min(total, paid);
        const balance = Math.max(0, Math.round(invoice.balance_due_minor ?? total - cappedPaid));
        return {
          ...invoice,
          customer_id: invoice.customer_id ?? null,
          payment_status: invoice.payment_status ?? (balance > 0 ? 'unpaid' : 'paid'),
          paid_minor: cappedPaid,
          balance_due_minor: balance,
          due_at: invoice.due_at ?? null,
        } as Invoice;
      },
    ),
  };
}

export interface ApplyOptions {
  mode: ImportMode;
}

async function applyRows(
  rows: AppliedRows,
  parsed: ParsedBackup,
  options: ApplyOptions,
  db: InventarDB,
): Promise<ImportSummary> {
  const summary = emptySummary();
  const photos = rows.photos.map(rehydratePhoto);

  await db.transaction(
    'rw',
    [
      db.profile,
      db.articles,
      db.variants,
      db.movements,
      db.expenses,
      db.customers,
      db.photos,
      db.meta,
      db.lots,
      db.invoices,
    ],
    async () => {
      if (options.mode === 'replace') {
        await Promise.all([
          db.profile.clear(),
          db.articles.clear(),
          db.variants.clear(),
          db.movements.clear(),
          db.expenses.clear(),
          db.customers.clear(),
          db.photos.clear(),
          db.lots.clear(),
          db.invoices.clear(),
        ]);
        await db.profile.bulkPut(rows.profile);
        await db.articles.bulkPut(rows.articles);
        await db.variants.bulkPut(rows.variants);
        await db.movements.bulkPut(rows.movements);
        await db.expenses.bulkPut(rows.expenses);
        await db.customers.bulkPut(rows.customers);
        await db.photos.bulkPut(photos);
        await db.lots.bulkPut(rows.lots);
        await db.invoices.bulkPut(rows.invoices);
        summary.inserted.profile = rows.profile.length;
        summary.inserted.articles = rows.articles.length;
        summary.inserted.variants = rows.variants.length;
        summary.inserted.movements = rows.movements.length;
        summary.inserted.expenses = rows.expenses.length;
        summary.inserted.customers = rows.customers.length;
        summary.inserted.photos = photos.length;
        summary.inserted.lots = rows.lots.length;
        summary.inserted.invoices = rows.invoices.length;
      } else {
        await mergeWithLWW(db.profile, rows.profile, summary, 'profile');
        await mergeWithLWW(db.articles, rows.articles, summary, 'articles');
        await mergeWithLWW(db.variants, rows.variants, summary, 'variants');
        await mergeWithLWW(db.expenses, rows.expenses, summary, 'expenses');
        await mergeWithLWW(db.customers, rows.customers, summary, 'customers');
        await mergeAppend(db.movements, rows.movements, summary, 'movements');
        await mergeAppend(db.photos, photos, summary, 'photos');
        // Lots: append-only by id (UUID prevents duplicates). Invoices:
        // same — never overwrite an existing invoice in merge mode.
        await mergeAppend(db.lots, rows.lots, summary, 'lots');
        await mergeAppend(db.invoices, rows.invoices, summary, 'invoices');
      }
    },
  );

  // v0.5.2.5 ADR-024: replay the per-year invoice counter so the next
  // issued invoice number stays monotonic. In replace mode we trust the
  // imported snapshot. In merge mode we keep the per-year MAX of
  // (existing, imported) so neither device's numbering regresses.
  if (parsed.kind === 'v3') {
    const importedCounter = parsed.backup.invoice_counter ?? {};
    if (options.mode === 'replace') {
      await setMeta(db, META_KEYS.invoice_counter, importedCounter);
    } else {
      const existingRaw = await db.meta.get(META_KEYS.invoice_counter);
      const existing: Record<string, number> =
        existingRaw && typeof existingRaw.value === 'object' && existingRaw.value !== null
          ? (existingRaw.value as Record<string, number>)
          : {};
      const merged: Record<string, number> = { ...existing };
      for (const [year, n] of Object.entries(importedCounter)) {
        merged[year] = Math.max(merged[year] ?? 0, n);
      }
      await setMeta(db, META_KEYS.invoice_counter, merged);
    }
  }

  // After importing a v1 file we set the same migration markers the
  // Dexie upgrade callback would set, so the migration-review banner /
  // screen can show the user any movements that need verification.
  if (parsed.kind === 'v1') {
    await setMeta(db, 'migration_v6_completed_at', new Date().toISOString());
  }

  return summary;
}

interface MergeableRow {
  id: string;
}
interface RowWithUpdatedAt extends MergeableRow {
  updated_at: string;
}

async function mergeWithLWW<R extends RowWithUpdatedAt>(
  table: { get(id: string): Promise<R | undefined>; put(row: R): Promise<unknown> },
  rows: R[],
  summary: ImportSummary,
  key: keyof AppliedRows,
): Promise<void> {
  for (const row of rows) {
    const existing = await table.get(row.id);
    if (!existing) {
      await table.put(row);
      summary.inserted[key]++;
      continue;
    }
    if (row.updated_at > existing.updated_at) {
      await table.put(row);
      summary.updated[key]++;
    } else {
      summary.skipped[key]++;
    }
  }
}

async function mergeAppend<R extends MergeableRow>(
  table: { get(id: string): Promise<R | undefined>; put(row: R): Promise<unknown> },
  rows: R[],
  summary: ImportSummary,
  key: keyof AppliedRows,
): Promise<void> {
  for (const row of rows) {
    const existing = await table.get(row.id);
    if (existing) {
      summary.skipped[key]++;
      continue;
    }
    await table.put(row);
    summary.inserted[key]++;
  }
}

// Applies a parsed backup. Used by the integration tests directly and by
// importBackup as the final step.
export async function applyBackup(
  parsed: ParsedBackup,
  options: ApplyOptions,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  // v3 carries lots + invoices natively. v2 needs them defaulted to []
  // by backfillV05Defaults. v1 goes through the migration kernels first
  // and ends up with the same v2-shape arrays empty.
  let raw: AppliedRows;
  if (parsed.kind === 'v3') {
    raw = parsed.backup.rows;
  } else if (parsed.kind === 'v2') {
    raw = parsed.backup.rows as unknown as AppliedRows;
  } else {
    raw = transformV1ToApplied(parsed.backup);
  }
  // v0.5 defensive backfill — the v2 envelope predates the v0.5 fields,
  // so a v2 backup taken before this version won't have barcode_ean,
  // shop_subtypes, etc. We fill nulls so the apply path never touches a
  // row missing required keys.
  const rows = backfillV05Defaults(raw);
  return applyRows(rows, parsed, options, db);
}

export interface ImportInput {
  data: string | BackupV1 | BackupV2 | BackupV3 | ParsedBackup;
  mode: ImportMode;
}

// Convenience entry: parse → verify → apply. Used by Settings → Import.
export async function importBackup(
  input: ImportInput,
  db: InventarDB = appDB,
): Promise<ImportSummary> {
  const parsed: ParsedBackup =
    typeof input.data === 'string' || isRawBackup(input.data)
      ? parseBackup(input.data as string | unknown)
      : (input.data as ParsedBackup);
  if (!(await verifyIntegrity(parsed))) {
    throw new BackupIntegrityError();
  }
  return applyBackup(parsed, { mode: input.mode }, db);
}

function isRawBackup(value: unknown): value is BackupV1 | BackupV2 | BackupV3 {
  return (
    typeof value === 'object' &&
    value !== null &&
    'format' in (value as Record<string, unknown>) &&
    'rows' in (value as Record<string, unknown>)
  );
}

// Re-exports used by callers / tests. Keeps the import surface tight.
export type { BackupV1, BackupV2, BackupV3 };
