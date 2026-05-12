import Dexie, { type Table } from 'dexie';
import type {
  Article,
  Expense,
  Invoice,
  Lot,
  MetaRow,
  Movement,
  Photo,
  ShopProfile,
  Variant,
} from '../types';
import { META_KEYS } from '../repos/meta';
import {
  migrateRowsV5ToV6,
  type V5Article,
  type V5Movement,
  type V5ShopProfile,
  type V5Variant,
} from './migrate-v5-to-v6';
import {
  migrateRowsV6ToV7,
  type V6Article,
  type V6Movement,
  type V6ShopProfile,
} from './migrate-v6-to-v7';
import { migrateRowsV8ToV9, type V8Article, type V8ShopProfile } from './migrate-v8-to-v9';

export const DB_NAME = 'inventar';

export class InventarDB extends Dexie {
  profile!: Table<ShopProfile, string>;
  articles!: Table<Article, string>;
  variants!: Table<Variant, string>;
  movements!: Table<Movement, string>;
  expenses!: Table<Expense, string>;
  photos!: Table<Photo, string>;
  meta!: Table<MetaRow, string>;
  lots!: Table<Lot, string>;
  invoices!: Table<Invoice, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      profile: 'id',
      articles:
        'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
      variants: 'id, article_id, [article_id+size], deleted_at',
      movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
      expenses: 'id, category, at, deleted_at',
      photos: 'id, deleted_at',
      meta: 'key',
    });
    // v2: Add logo_photo_id (non-indexed) to ShopProfile. Schema strings are
    // unchanged — the bump exists purely to backfill the new field on rows
    // that predate the change so reads return null instead of undefined.
    this.version(2)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { logo_photo_id?: string | null }) => {
            if (!('logo_photo_id' in p)) p.logo_photo_id = null;
          });
      });
    // v3: Add currency (non-indexed) to ShopProfile, defaulting to 'TND' for
    // existing installs (the only currency that ever existed before this
    // migration). New rows pick a currency at onboarding.
    this.version(3)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { currency?: string }) => {
            if (!('currency' in p)) p.currency = 'TND';
          });
      });
    // v4: Add store_type to ShopProfile, default 'shoes' for existing
    // installs (the only thing the app supported pre-multi-vertical).
    this.version(4)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { store_type?: string }) => {
            if (!('store_type' in p)) p.store_type = 'shoes';
          });
      });
    // v5: Add unit_price_tnd to Movement, defaulting to null on existing
    // rows. null means "use the article's current sale_price_tnd at read
    // time" — preserves prior revenue calculations exactly.
    this.version(5)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, *colors, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], deleted_at',
        movements: 'id, variant_id, type, created_at, [variant_id+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('movements')
          .toCollection()
          .modify((m: { unit_price_tnd?: number | null }) => {
            if (!('unit_price_tnd' in m)) m.unit_price_tnd = null;
          });
      });
    // v6: ADR-011 / ADR-012. Three structural changes:
    //   1. Drop the *colors multi-entry index from articles. The colours[]
    //      cache stays as a denormalised field for legacy reads through
    //      the v0.3 transition, but indexed colour lookup moves to
    //      Variant.color via the new [article_id+color+size] compound.
    //   2. Variants gain `color` and `photo_id`. Existing variants fan
    //      out — one new variant per (article.colors[] × old variant).
    //      Legacy variant rows get tombstoned (deleted_at set) so old
    //      backups re-imported still find them by id.
    //   3. Movements gain `location`, `transfer_from`, `transfer_to`.
    //      Every existing movement is remapped to a new variant id; on
    //      ambiguity (article had ≥2 colours), we attribute to the
    //      alphabetically-first colour and append a marker note so the
    //      review screen lists it.
    this.version(6)
      .stores({
        profile: 'id',
        articles: 'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        // Read every legacy row up front. The catalogue is small (MVP cap
        // ~500 articles per SPEC §5) so reading into memory is cheap and
        // lets us run the pure transformation kernel without juggling
        // partial state inside the upgrade callback.
        const profileRow = (await tx.table('profile').get('singleton')) as
          | V5ShopProfile
          | undefined;
        const articles = (await tx.table('articles').toArray()) as V5Article[];
        const variants = (await tx.table('variants').toArray()) as V5Variant[];
        const movements = (await tx.table('movements').toArray()) as V5Movement[];

        const { rows, report } = migrateRowsV5ToV6({
          profile: profileRow ?? null,
          articles,
          variants,
          movements,
        });

        // Replace variants and movements wholesale. Articles get an
        // in-place patch so we don't lose any field that the migration
        // didn't touch (the kernel only rewrites `colors`).
        await tx.table('variants').clear();
        if (rows.variants.length > 0) {
          await tx.table('variants').bulkAdd(rows.variants);
        }
        await tx.table('movements').clear();
        if (rows.movements.length > 0) {
          await tx.table('movements').bulkAdd(rows.movements);
        }
        for (const a of rows.articles) {
          await tx.table('articles').put(a);
        }

        await tx.table('meta').put({
          key: META_KEYS.migration_v6_completed_at,
          value: new Date().toISOString(),
        });
        // Stash the report for the migration-review screen / banner so
        // the UI doesn't have to recompute it from scratch.
        await tx.table('meta').put({
          key: 'migration_v6_report',
          value: report,
        });
      });
    // v7: ADR-017 / ADR-018 / ADR-019. Five additive changes:
    //   1. ShopProfile: store_type 'kiosk'/'grocery' rewritten to 'shop'
    //      with shop_subtypes derived from the legacy vertical
    //      (kiosk → ['tobacco_lottery', 'snacks_confectionery'],
    //      grocery → ['food_beverages']). All other store_types untouched.
    //   2. Article: barcode_ean (indexed) + min_stock_threshold default
    //      to null. Both are optional fields that the new shop flows
    //      populate going forward.
    //   3. Movement: transaction_id + expires_at + lot_id default to null.
    //      transaction_id and expires_at gain indexes; lot_id stays
    //      non-indexed (queries are always scoped to a single lot).
    //   4. New `lots` table indexed on [variant_id+expires_at] for FIFO
    //      queries and on source_movement_id for back-reference. No rows
    //      backfilled — only new /receive sessions create lots.
    //   5. meta.migration_v7_completed_at written so the e2e smoke and
    //      future debugging can confirm the upgrade ran.
    this.version(7)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
      })
      .upgrade(async (tx) => {
        // Pure kernel: read every row, transform in memory, write back.
        // Catalogues are small (~500 articles per SPEC §5) so the
        // memory overhead is irrelevant; the kernel staying pure makes
        // it unit-testable in fake-indexeddb without spinning a Dexie
        // upgrade pipeline.
        const profileRow = (await tx.table('profile').get('singleton')) as
          | V6ShopProfile
          | undefined;
        const articles = (await tx.table('articles').toArray()) as V6Article[];
        const movements = (await tx.table('movements').toArray()) as V6Movement[];

        const { rows } = migrateRowsV6ToV7({
          profile: profileRow ?? null,
          articles,
          movements,
        });

        if (rows.profile) {
          await tx.table('profile').put(rows.profile);
        }
        for (const a of rows.articles) {
          await tx.table('articles').put(a);
        }
        for (const m of rows.movements) {
          await tx.table('movements').put(m);
        }

        await tx.table('meta').put({
          key: META_KEYS.migration_v7_completed_at,
          value: new Date().toISOString(),
        });
      });
    // v8: post-v0.5 follow-up. Adds `Movement.refunds_movement_id` and
    // its index — links a return movement back to the sale it's
    // refunding. Lets remainingForLot credit returns back to the lot
    // their source sale depleted, and lets Quick Adjust default the
    // refund price to the original sale's price (not whatever the
    // catalogue says today). Existing rows backfill to null.
    this.version(8)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('movements')
          .toCollection()
          .modify((m: { refunds_movement_id?: string | null }) => {
            if (!('refunds_movement_id' in m)) m.refunds_movement_id = null;
          });
      });
    // v9: ADR-021 / ADR-022 / ADR-023 — vertical consolidation
    // (shoes + clothes → fashion), customisable location labels, and
    // the per-article expiry-alert override. Five additive changes:
    //   1. ShopProfile.fashion_subtypes (new field, default []).
    //   2. ShopProfile.location_floor_label / location_back_label
    //      (new fields, defaulted from locale + new vertical via the
    //      kernel).
    //   3. ShopProfile.expiry_warning_days (new field, copied from the
    //      pre-v9 meta key `expiry_threshold_days` if present; the meta
    //      key stays readable for one release for backup compat — see
    //      NON_GOALS: drop in v0.7+).
    //   4. ShopProfile.store_type 'shoes' / 'clothes' rewritten to
    //      'fashion' with fashion_subtypes derived from the legacy
    //      vertical (shoes → ['shoes'], clothes → ['clothing_men',
    //      'clothing_women']).
    //   5. Article.expiry_alert_days (new field, default null).
    //
    // No schema string changes on movements / lots / variants — v9 only
    // touches profile + articles. The Lot table is unchanged.
    //
    // Idempotency: gated on meta.migration_v9_completed_at. A re-run
    // (Dexie history replay, manual db.open() after a crash) skips the
    // entire data path. The sentinel key is also what /migrations/
    // confirm-subtypes uses to decide whether to render the banner.
    this.version(9)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
      })
      .upgrade(async (tx) => {
        const completed = await tx.table('meta').get(META_KEYS.migration_v9_completed_at);
        if (completed?.value) return;
        const profileRow = (await tx.table('profile').get('singleton')) as
          | V8ShopProfile
          | undefined;
        const articles = (await tx.table('articles').toArray()) as V8Article[];
        const expiryMetaRow = await tx.table('meta').get(META_KEYS.expiry_threshold_days);
        const expiryMetaValue =
          typeof expiryMetaRow?.value === 'number' ? (expiryMetaRow.value as number) : null;

        const { rows } = migrateRowsV8ToV9({
          profile: profileRow ?? null,
          articles,
          expiryThresholdDaysMeta: expiryMetaValue,
        });
        if (rows.profile) {
          await tx.table('profile').put(rows.profile);
        }
        for (const a of rows.articles) {
          await tx.table('articles').put(a);
        }
        await tx.table('meta').put({
          key: META_KEYS.migration_v9_completed_at,
          value: new Date().toISOString(),
        });
      });
    // v10: ADR-024 — invoicing / Facture. Two additive changes:
    //   1. ShopProfile gains four nullable fiscal fields (legal_name,
    //      legal_address, fiscal_id, default_vat_pct). Backfilled to
    //      null on existing rows; the Settings → Invoicing section is
    //      where the merchant fills them in.
    //   2. New `invoices` table for issued invoices. Indexed on
    //      `number` (uniqueness check), `issued_at` (chronological
    //      list), and `transaction_id` (back-link from /sell). Photos /
    //      logos are NOT duplicated — invoice render reads
    //      profile.logo_photo_id at print time.
    //
    // Idempotency: the `if ('legal_name' in p)` guard means a re-entry
    // (Dexie history replay, manual reopen) leaves merchant-set
    // values alone instead of clobbering them back to null.
    this.version(10)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
        invoices: 'id, &number, issued_at, transaction_id, deleted_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify(
            (p: {
              legal_name?: string | null;
              legal_address?: string | null;
              fiscal_id?: string | null;
              default_vat_pct?: number | null;
            }) => {
              if (!('legal_name' in p)) p.legal_name = null;
              if (!('legal_address' in p)) p.legal_address = null;
              if (!('fiscal_id' in p)) p.fiscal_id = null;
              if (!('default_vat_pct' in p)) p.default_vat_pct = null;
            },
          );
      });

    // v0.5.2.7 — invoicing phone number. Same shape as the v10 invoice
    // block: nullable column on the profile singleton, defaulted on
    // upgrade, no index needed (single-row table). Stored verbatim so
    // the merchant can include the country code, dashes, slashes, or
    // anything else their customers expect on a printed invoice.
    this.version(11)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
        invoices: 'id, &number, issued_at, transaction_id, deleted_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { phone?: string | null }) => {
            if (!('phone' in p)) p.phone = null;
          });
      });

    // v0.5.2.9 (Phase B + UoM) — per-article trait overrides + unit-
    // of-measure. Four new columns on Article:
    //   - has_sizes / has_colors / has_expiry: nullable booleans. Null
    //     means "follow the store_type default" (back-compat). A
    //     concrete true/false overrides at the article level — lets a
    //     fashion-vertical merchant add a single-SKU drink, or a shop-
    //     vertical merchant add a sized T-shirt.
    //   - unit_of_measure: required string, default 'piece'. Drives
    //     display + qty input precision (kg / g / l / ml). Stored
    //     deltas remain integer in the smallest unit (grams for
    //     kg/g, ml for l/ml, pieces for piece) so the existing
    //     revenue math `|delta| * sale_price_tnd` stays correct.
    this.version(12)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
        invoices: 'id, &number, issued_at, transaction_id, deleted_at',
      })
      .upgrade(async (tx) => {
        await tx
          .table('articles')
          .toCollection()
          .modify(
            (a: {
              has_sizes?: boolean | null;
              has_colors?: boolean | null;
              has_expiry?: boolean | null;
              unit_of_measure?: 'piece' | 'kg' | 'g' | 'l' | 'ml';
            }) => {
              if (!('has_sizes' in a)) a.has_sizes = null;
              if (!('has_colors' in a)) a.has_colors = null;
              if (!('has_expiry' in a)) a.has_expiry = null;
              if (!('unit_of_measure' in a)) a.unit_of_measure = 'piece';
            },
          );
      });

    // v0.6.3 ADR-029 amendment — location labels move from per-locale
    // display strings ("Shop floor" / "Magasin" / "المحل") to
    // locale-neutral keys ("shop_floor") so the dropdown picker always
    // resolves to the current UI locale. Merchant-typed custom values
    // get a `custom:` sentinel prefix so the read-side hook can
    // distinguish them from keys.
    //
    // The upgrade walks every profile row and rewrites
    // location_front_label / location_back_label via normaliseFront/Back
    // (zone-aware reverse lookup). Idempotent: re-running on already-
    // migrated keys / custom: values is a no-op.
    this.version(13)
      .stores({
        profile: 'id',
        articles:
          'id, internal_code, category, archived_at, deleted_at, updated_at, search_blob, barcode_ean',
        variants: 'id, article_id, [article_id+size], [article_id+color+size], deleted_at',
        movements:
          'id, variant_id, type, created_at, [variant_id+created_at], [variant_id+location+created_at], deleted_at, transaction_id, expires_at, refunds_movement_id',
        expenses: 'id, category, at, deleted_at',
        photos: 'id, deleted_at',
        meta: 'key',
        lots: 'id, variant_id, expires_at, [variant_id+expires_at], source_movement_id, deleted_at',
        invoices: 'id, &number, issued_at, transaction_id, deleted_at',
      })
      .upgrade(async (tx) => {
        const { normaliseFrontLabel, normaliseBackLabel } = await import(
          '../config/location-options'
        );
        await tx
          .table('profile')
          .toCollection()
          .modify((p: { location_floor_label?: string; location_back_label?: string }) => {
            if (typeof p.location_floor_label === 'string' && p.location_floor_label !== '') {
              p.location_floor_label = normaliseFrontLabel(p.location_floor_label);
            }
            if (typeof p.location_back_label === 'string' && p.location_back_label !== '') {
              p.location_back_label = normaliseBackLabel(p.location_back_label);
            }
          });
      });
  }
}

export const db = new InventarDB();

// One-shot full database wipe used by Settings → Reset everything (SPEC §2.9
// destructive flow). Lives in /src/db/ so call sites don't have to reach
// for raw indexedDB outside this folder.
export async function resetDatabase(): Promise<void> {
  db.close();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // other tab still open; resolve anyway
  });
}
