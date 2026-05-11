import { type InventarDB } from '../db/db';
import { type Location, type Movement, type UUID, type Variant } from '../types';

// ADR-002 (movement-as-truth) + ADR-012 (location dimension).
//
// Quantity is derived from the sum of non-tombstoned movement deltas. The
// per-location rules (per the v0.3 plan):
//   For type ∈ {sale, purchase, adjustment, return, damage} and location=L:
//     contribute m.delta to L.
//   For type='transfer' with transfer_to=L:
//     contribute +abs(m.delta) to L.
//   For type='transfer' with transfer_from=L:
//     contribute -abs(m.delta) to L.
//
// The total per variant is the sum of both location buckets — the existing
// quantityFor(variantId) keeps its v1 signature and now sums across both.

export type LocationQuantity = Record<Location, number>;

function emptyByLocation(): LocationQuantity {
  return { floor: 0, back: 0 };
}

function applyMovement(buckets: LocationQuantity, m: Movement): void {
  if (m.deleted_at !== null) return;
  if (m.type === 'transfer') {
    const abs = Math.abs(m.delta);
    if (m.transfer_from === 'floor' || m.transfer_from === 'back') {
      buckets[m.transfer_from] -= abs;
    }
    if (m.transfer_to === 'floor' || m.transfer_to === 'back') {
      buckets[m.transfer_to] += abs;
    }
    return;
  }
  if (m.location === 'floor' || m.location === 'back') {
    buckets[m.location] += m.delta;
  }
}

export async function quantityForLocation(
  db: InventarDB,
  variantId: UUID,
  location: Location,
): Promise<number> {
  const buckets = emptyByLocation();
  await db.movements
    .where('variant_id')
    .equals(variantId)
    .each((m) => applyMovement(buckets, m));
  return buckets[location];
}

export async function quantityByLocation(
  db: InventarDB,
  variantId: UUID,
): Promise<LocationQuantity> {
  const buckets = emptyByLocation();
  await db.movements
    .where('variant_id')
    .equals(variantId)
    .each((m) => applyMovement(buckets, m));
  return buckets;
}

// Total stock for a variant — sums floor + back. Preserves the v1 signature
// so legacy callers (search ranking, dashboard totals) keep working without
// having to learn about locations.
export async function quantityFor(db: InventarDB, variantId: UUID): Promise<number> {
  const { floor, back } = await quantityByLocation(db, variantId);
  return floor + back;
}

export interface SizeGridCell {
  variant_id: UUID;
  // Null for sizeless store types (kiosk / grocery).
  size: string | null;
  // Null for colourless store types.
  color: string | null;
  // v0.5.2.8 — per-variant photo (the per-colour photo from Add Article).
  // Null = fall back to Article.photo_id at render time. Carried through
  // SizeGridCell so the Article Detail color-swatch strip can render a
  // thumbnail per colour without a second round-trip to variants.
  photo_id: UUID | null;
  qty: number;
  floor: number;
  back: number;
  hidden: boolean;
}

// Returns one cell per alive variant of the article, ordered first by
// colour (alphabetical, null first) then by size (numeric where possible).
// Hidden variants come back with `hidden: true` so the UI can decide
// whether to render them (long-press on a cell hides cosmetically; SPEC §2.3).
export async function sizeGridFor(db: InventarDB, articleId: UUID): Promise<SizeGridCell[]> {
  const variants: Variant[] = await db.variants
    .where('article_id')
    .equals(articleId)
    .filter((v) => v.deleted_at === null)
    .toArray();

  const sorted = variants.slice().sort(compareVariants);

  return Promise.all(
    sorted.map(async (v) => {
      const buckets = await quantityByLocation(db, v.id);
      return {
        variant_id: v.id,
        size: v.size,
        color: v.color,
        photo_id: v.photo_id,
        qty: buckets.floor + buckets.back,
        floor: buckets.floor,
        back: buckets.back,
        hidden: v.hidden,
      };
    }),
  );
}

function compareVariants(a: Variant, b: Variant): number {
  // Colour first: null sorts before any string so colourless stores keep a
  // single deterministic group.
  if (a.color !== b.color) {
    if (a.color === null) return -1;
    if (b.color === null) return 1;
    const c = a.color.localeCompare(b.color);
    if (c !== 0) return c;
  }
  // Size second, numeric when both parse as numbers.
  const sa = a.size ?? '';
  const sb = b.size ?? '';
  return sa.localeCompare(sb, undefined, { numeric: true });
}

export interface ColorRow {
  color: string | null;
  cells: Array<{
    variant_id: UUID;
    size: string | null;
    qty: number;
    floor: number;
    back: number;
    hidden: boolean;
  }>;
}

export interface ColorSizeMatrix {
  // Distinct sizes across the article, in display order. Null sizes
  // produce a single column whose header is rendered as a placeholder
  // by the article-detail screen.
  sizes: Array<string | null>;
  // Rows in display order. Each row covers every column from `sizes` —
  // missing (color, size) pairs surface as empty cells with qty=0 so
  // the UI doesn't have to handle ragged rows.
  rows: ColorRow[];
}

// Builds the rows × columns grid the Article Detail matrix view consumes.
// For verticals where has_colors=false the result has a single row whose
// `color` is null; for verticals where has_sizes=false the result has a
// single column whose size is null. The intersection (sizeless +
// colourless) yields exactly one cell.
export async function colorSizeMatrix(db: InventarDB, articleId: UUID): Promise<ColorSizeMatrix> {
  const cells = await sizeGridFor(db, articleId);

  const sizeOrder: Array<string | null> = [];
  const sizeSeen = new Set<string>();
  for (const c of cells) {
    const key = c.size ?? '';
    if (sizeSeen.has(key)) continue;
    sizeSeen.add(key);
    sizeOrder.push(c.size);
  }
  sizeOrder.sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const byColor = new Map<string, ColorRow>();
  const colorOrder: Array<string | null> = [];
  for (const c of cells) {
    const key = c.color ?? '';
    if (!byColor.has(key)) {
      colorOrder.push(c.color);
      byColor.set(key, { color: c.color, cells: [] });
    }
  }

  const rows: ColorRow[] = colorOrder.map((color) => {
    const key = color ?? '';
    const row = byColor.get(key)!;
    // For each size column, find the cell or synthesise an empty one.
    const filled = sizeOrder.map((size) => {
      const cell = cells.find((c) => (c.color ?? '') === key && (c.size ?? '') === (size ?? ''));
      if (cell) {
        return {
          variant_id: cell.variant_id,
          size: cell.size,
          qty: cell.qty,
          floor: cell.floor,
          back: cell.back,
          hidden: cell.hidden,
        };
      }
      // No (colour, size) variant exists — return a synthetic placeholder
      // with no variant_id. The matrix UI renders a dimmed cell that is
      // not tappable (cell.variant_id === '' guard).
      return { variant_id: '', size, qty: 0, floor: 0, back: 0, hidden: false };
    });
    return { color: row.color, cells: filled };
  });

  return { sizes: sizeOrder, rows };
}
