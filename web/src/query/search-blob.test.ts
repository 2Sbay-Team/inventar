import { describe, expect, it } from 'vitest';
import { computeSearchBlob, type IndexableArticle } from './search-blob';
import { tokenise } from './tokenise';

function article(overrides: Partial<IndexableArticle> = {}): IndexableArticle {
  return {
    name: '',
    internal_code: '',
    brand: null,
    colors: [],
    category: 'casual',
    notes: null,
    ...overrides,
  };
}

describe('computeSearchBlob', () => {
  it('joins name, internal_code, brand, colors, category, notes into a single space-separated lowercase blob', () => {
    const blob = computeSearchBlob(
      article({
        name: 'Running Shoe',
        internal_code: 'SH-0042',
        brand: 'Nike',
        colors: ['white', 'black'],
        category: 'sport',
        notes: 'fast seller',
      }),
    );
    expect(blob).toBe('running shoe sh-0042 nike white black sport fast seller');
  });

  it('treats null brand and notes as empty strings (still spaced)', () => {
    const blob = computeSearchBlob(
      article({
        name: 'Shoe',
        internal_code: 'SH-0001',
        colors: ['red'],
        category: 'casual',
      }),
    );
    expect(blob).toBe('shoe sh-0001  red casual ');
  });

  it('strips French diacritics so the blob is index-pure ASCII for Latin tokens', () => {
    const blob = computeSearchBlob(
      article({
        name: 'café noir',
        internal_code: 'SH-0001',
        category: 'casual',
      }),
    );
    expect(blob).toContain('cafe');
    expect(blob).not.toContain('café');
  });

  it('preserves Arabic harakat in the blob — DATA_MODEL §5 leaves them alone (Tunisian input is unvocalised)', () => {
    // If a user did happen to enter vocalised text, the blob keeps the
    // harakat. Search would then only hit on a vocalised query token —
    // which is acceptable per spec since the trilingual SPEC §1.4 examples
    // all assume unvocalised input on both sides.
    const blob = computeSearchBlob(
      article({
        name: 'أَبْيَض',
        internal_code: 'SH-0042',
        category: 'casual',
      }),
    );
    expect(blob).toContain('َ'); // U+064E fatha — preserved
  });

  it('normalises Eastern Arabic digits in the index — symmetric with tokenise', () => {
    const blob = computeSearchBlob(
      article({
        name: 'size ٤٢',
        internal_code: 'SH-0042',
        category: 'casual',
      }),
    );
    expect(blob).toContain('42');
    expect(blob).not.toContain('٤٢');
  });

  it('stays in sync with tokenise: every tokenise() output token is a substring of the blob (SPEC §1.4 trilingual search)', () => {
    // The article carries all three colour names so prefix search on any
    // locale's word can hit it. computeSearchBlob and tokenise must share
    // the same canonical form — this is the test that locks that contract.
    const blob = computeSearchBlob(
      article({
        name: 'White running shoe / blanc / أبيض',
        internal_code: 'SH-0042',
        colors: ['white', 'blanc', 'أبيض'],
        category: 'sport',
      }),
    );
    for (const query of ['white 42', 'blanc 42', 'أبيض ٤٢']) {
      for (const token of tokenise(query)) {
        expect(blob).toContain(token);
      }
    }
  });

  it('is deterministic: same input → same output', () => {
    const a = article({
      name: 'Shoe',
      internal_code: 'SH-0001',
      colors: ['red'],
      category: 'casual',
    });
    expect(computeSearchBlob(a)).toBe(computeSearchBlob(a));
  });

  it('reads only from IndexableArticle fields — variant data has no path into the blob', () => {
    // DATA_MODEL §5: sizes live on Variant, matched via a join. The
    // IndexableArticle type intentionally omits Variant fields so a refactor
    // that tries to include sizes is a compile error, not a runtime drift.
    // This runtime check verifies the field-set is the expected six and
    // nothing else gets joined in.
    const blob = computeSearchBlob({
      name: 'PRODUCT_NAME',
      internal_code: 'INTERNAL_CODE',
      brand: 'BRAND_NAME',
      colors: ['COLOR_A', 'COLOR_B'],
      category: 'sport',
      notes: 'NOTES_TEXT',
    });
    // Each of the six fields is present (lowercased)…
    expect(blob).toContain('product_name');
    expect(blob).toContain('internal_code');
    expect(blob).toContain('brand_name');
    expect(blob).toContain('color_a');
    expect(blob).toContain('color_b');
    expect(blob).toContain('sport');
    expect(blob).toContain('notes_text');
    // …and the blob is exactly that joined set, no extra fields snuck in.
    expect(blob).toBe('product_name internal_code brand_name color_a color_b sport notes_text');
  });
});
