import { describe, expect, it } from 'vitest';
import { REDUCED_VAT_PCT_DEFAULT, type Article, type ShopProfile } from '../types';
import { getTaxRate } from './tax-rate';

// v0.9 ADR-041 — covers the brief's N+2…N+5, N+7 acceptance criteria
// for the per-article tax resolver. The N+6 (Add Article hides field
// when default_vat unset) and N+8 (translated labels) checks belong
// in e2e; they exercise the UI, not the resolver.

function makeArticle(over: Partial<Article> = {}): Article {
  // Minimal Article scaffold — the resolver only reads two fields, so
  // we stub everything else with sentinels just thorough enough for
  // the type to compile.
  return {
    id: 'a-1',
    internal_code: 'TST-0001',
    name: 'Test',
    photo_id: null,
    category: 'sport',
    colors: [],
    brand: null,
    cost_price_tnd: 0,
    sale_price_tnd: 0,
    notes: null,
    barcode_ean: null,
    min_stock_threshold: null,
    expiry_alert_days: null,
    has_sizes: null,
    has_colors: null,
    has_expiry: null,
    unit_of_measure: 'piece',
    tax_category: null,
    tax_custom_rate: null,
    search_blob: '',
    updated_at: '2026-05-12T00:00:00.000Z',
    archived_at: null,
    deleted_at: null,
    ...over,
  };
}

function makeProfile(default_vat_pct: number | null): Pick<ShopProfile, 'default_vat_pct'> {
  return { default_vat_pct };
}

describe('getTaxRate', () => {
  it('N+2: null tax_category → shop default VAT', () => {
    const a = makeArticle({ tax_category: null });
    expect(getTaxRate(a, makeProfile(19))).toBe(19);
    expect(getTaxRate(a, makeProfile(20))).toBe(20);
  });

  it("'standard' tax_category → shop default VAT (same as null)", () => {
    const a = makeArticle({ tax_category: 'standard' });
    expect(getTaxRate(a, makeProfile(19))).toBe(19);
  });

  it(`N+3: 'reduced' → REDUCED_VAT_PCT_DEFAULT (${REDUCED_VAT_PCT_DEFAULT})`, () => {
    const a = makeArticle({ tax_category: 'reduced' });
    // Independent of the shop's default — reduced is a fixed bucket.
    expect(getTaxRate(a, makeProfile(19))).toBe(REDUCED_VAT_PCT_DEFAULT);
    expect(getTaxRate(a, makeProfile(null))).toBe(REDUCED_VAT_PCT_DEFAULT);
  });

  it("N+4: 'zero' → 0 (not null) regardless of shop default", () => {
    const a = makeArticle({ tax_category: 'zero' });
    expect(getTaxRate(a, makeProfile(19))).toBe(0);
    expect(getTaxRate(a, makeProfile(null))).toBe(0);
  });

  it("N+5: 'custom' + rate 12 → 12", () => {
    const a = makeArticle({ tax_category: 'custom', tax_custom_rate: 12 });
    expect(getTaxRate(a, makeProfile(19))).toBe(12);
    // Custom rate wins even when the shop default is null.
    expect(getTaxRate(a, makeProfile(null))).toBe(12);
  });

  it("'custom' with null rate falls through to shop default", () => {
    // Defensive: a half-set 'custom' (UX bug or stale data) should
    // never silently zero out the VAT — fall back to the shop band.
    const a = makeArticle({ tax_category: 'custom', tax_custom_rate: null });
    expect(getTaxRate(a, makeProfile(19))).toBe(19);
    expect(getTaxRate(a, makeProfile(null))).toBeNull();
  });

  it('N+7: existing articles (null tax_category) behave correctly across shop VAT values', () => {
    // Pre-v17 articles read back with tax_category=null after the
    // v15→v17 migration backfill. The merchant flipping the shop
    // default in Settings should retroactively change what every
    // such article resolves to — no per-article migration needed.
    const a = makeArticle({ tax_category: null });
    expect(getTaxRate(a, makeProfile(19))).toBe(19);
    expect(getTaxRate(a, makeProfile(7))).toBe(7);
    expect(getTaxRate(a, makeProfile(0))).toBe(0);
    expect(getTaxRate(a, makeProfile(null))).toBeNull();
  });

  it('returns null when neither article nor profile pins a rate', () => {
    // The boundary case: brand-new shop, brand-new article, VAT not
    // configured. Callers (invoice line render, sale total) must
    // detect null and hide the VAT row rather than print "0%".
    const a = makeArticle({ tax_category: null });
    expect(getTaxRate(a, makeProfile(null))).toBeNull();
    // And: null profile (still loading) is the same as no default.
    expect(getTaxRate(a, null)).toBeNull();
  });

  it("'zero' beats a null profile — explicit zero is not the same as 'no VAT configured'", () => {
    const a = makeArticle({ tax_category: 'zero' });
    expect(getTaxRate(a, null)).toBe(0);
  });
});
