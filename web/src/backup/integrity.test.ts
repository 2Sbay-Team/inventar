import { describe, expect, it } from 'vitest';
import { canonicalStringify, integrityHash } from './integrity';
import type { ExportRowsV1 } from './format-v1';

describe('canonicalStringify', () => {
  it('emits object keys in sorted order', () => {
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalStringify({ z: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"z":1}');
  });
  it('preserves array order', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });
  it('serialises primitives like JSON.stringify', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify('x')).toBe('"x"');
    expect(canonicalStringify(42)).toBe('42');
  });
  it('produces identical output regardless of input key order', () => {
    const a = canonicalStringify({ x: { p: 1, q: 2 }, y: [1, 2] });
    const b = canonicalStringify({ y: [1, 2], x: { q: 2, p: 1 } });
    expect(a).toBe(b);
  });
});

describe('integrityHash', () => {
  function emptyRows(): ExportRowsV1 {
    return { profile: [], articles: [], variants: [], movements: [], expenses: [], photos: [] };
  }

  it('returns a 64-char hex string', async () => {
    const h = await integrityHash(emptyRows());
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', async () => {
    const a = await integrityHash(emptyRows());
    const b = await integrityHash(emptyRows());
    expect(a).toBe(b);
  });

  it('changes when any row changes', async () => {
    const rows1 = emptyRows();
    const rows2 = emptyRows();
    rows2.profile.push({
      id: 'singleton',
      name: 'X',
      locale: 'fr',
      logo_photo_id: null,
      currency: 'TND',
      store_type: 'shoes',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      last_backup_at: null,
    });
    const h1 = await integrityHash(rows1);
    const h2 = await integrityHash(rows2);
    expect(h1).not.toBe(h2);
  });
});
