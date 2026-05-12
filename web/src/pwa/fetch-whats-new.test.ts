import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWhatsNew, isValidWhatsNew, parseWhatsNew } from './fetch-whats-new';

// v0.6 ADR-031 / v0.6.2 ADR-032 — unit tests for the whats-new.json
// fetcher. The v0.6.2 risk-level fields are validated strictly: a
// 'migration' or 'breaking' risk_level without a valid migration
// block causes the whole payload to be rejected, so the caller falls
// through to the SKIP_SENTINEL_UNKNOWN path rather than rendering
// reassuring copy on a risky update.

const VALID_PAYLOAD = {
  version: '0.6.0',
  released_at: '2026-06-01',
  highlights: {
    en: ['One', 'Two'],
    fr: ['Un', 'Deux'],
    ar: ['واحد', 'اثنان'],
  },
};

const VALID_MIGRATION = {
  summary: {
    en: 'Articles gain a new column.',
    fr: 'Les articles gagnent une nouvelle colonne.',
    ar: 'تكتسب المنتجات عمودًا جديدًا.',
  },
  data_affected: ['articles'],
  data_preservation: 'No rows are deleted.',
  rollback_supported: true,
};

const VALID_BACKUP_CHANGE = {
  from: 'v3',
  to: 'v4',
  backwards_compatible_import: true,
  forwards_compatible_export: false,
};

describe('isValidWhatsNew — shape guard', () => {
  it('accepts a well-formed payload', () => {
    expect(isValidWhatsNew(VALID_PAYLOAD)).toBe(true);
  });

  it('rejects null / undefined / primitives', () => {
    expect(isValidWhatsNew(null)).toBe(false);
    expect(isValidWhatsNew(undefined)).toBe(false);
    expect(isValidWhatsNew('not an object')).toBe(false);
    expect(isValidWhatsNew(42)).toBe(false);
  });

  it('rejects missing version', () => {
    const { version: _v, ...rest } = VALID_PAYLOAD;
    expect(isValidWhatsNew(rest)).toBe(false);
  });

  it('rejects empty-string version', () => {
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, version: '   ' })).toBe(false);
  });

  it('rejects when a locale highlight is missing', () => {
    expect(
      isValidWhatsNew({
        ...VALID_PAYLOAD,
        highlights: { en: ['one'], fr: ['un'] /* ar missing */ },
      }),
    ).toBe(false);
  });

  it('rejects when a locale highlight is not an array of strings', () => {
    expect(
      isValidWhatsNew({
        ...VALID_PAYLOAD,
        highlights: { ...VALID_PAYLOAD.highlights, en: [42, 'two'] },
      }),
    ).toBe(false);
  });

  // ── v0.6.2 risk-level fields ─────────────────────────────────────

  it('accepts a payload with no risk_level (legacy file)', () => {
    expect(isValidWhatsNew(VALID_PAYLOAD)).toBe(true);
  });

  it('accepts risk_level="safe" without a migration block', () => {
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, risk_level: 'safe' })).toBe(true);
  });

  it('accepts risk_level="migration" with a valid migration block', () => {
    expect(
      isValidWhatsNew({
        ...VALID_PAYLOAD,
        risk_level: 'migration',
        migration: VALID_MIGRATION,
      }),
    ).toBe(true);
  });

  it('accepts risk_level="breaking" with valid migration + backup_format_change', () => {
    expect(
      isValidWhatsNew({
        ...VALID_PAYLOAD,
        risk_level: 'breaking',
        migration: VALID_MIGRATION,
        backup_format_change: VALID_BACKUP_CHANGE,
      }),
    ).toBe(true);
  });

  it('rejects risk_level="migration" with a null migration block (authoring bug)', () => {
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, risk_level: 'migration', migration: null })).toBe(
      false,
    );
  });

  it('rejects risk_level="breaking" with the migration field missing entirely', () => {
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, risk_level: 'breaking' })).toBe(false);
  });

  it('rejects an unknown risk_level value', () => {
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, risk_level: 'critical' })).toBe(false);
  });

  it('rejects a migration block missing a required locale summary', () => {
    const badMigration = {
      ...VALID_MIGRATION,
      // ar missing → fail
      summary: { en: 'en', fr: 'fr' },
    };
    expect(
      isValidWhatsNew({ ...VALID_PAYLOAD, risk_level: 'migration', migration: badMigration }),
    ).toBe(false);
  });

  it('rejects a backup_format_change missing the to-version', () => {
    const badChange = { ...VALID_BACKUP_CHANGE, to: '' };
    expect(isValidWhatsNew({ ...VALID_PAYLOAD, backup_format_change: badChange })).toBe(false);
  });

  it('accepts a safe payload that still ships a valid backup_format_change', () => {
    // A bi-directional format bump can ride a safe update — both
    // import + export compatibility flags are independent of
    // risk_level, so this combination is a legitimate scenario.
    expect(
      isValidWhatsNew({
        ...VALID_PAYLOAD,
        risk_level: 'safe',
        backup_format_change: {
          from: 'v3',
          to: 'v4',
          backwards_compatible_import: true,
          forwards_compatible_export: true,
        },
      }),
    ).toBe(true);
  });
});

describe('parseWhatsNew — normalization', () => {
  it('returns null for a malformed payload', () => {
    expect(parseWhatsNew({ version: '1.0' })).toBeNull();
  });

  it('fills missing risk_level with "safe" and missing optional blocks with null', () => {
    const parsed = parseWhatsNew(VALID_PAYLOAD);
    expect(parsed).toEqual({
      ...VALID_PAYLOAD,
      risk_level: 'safe',
      migration: null,
      backup_format_change: null,
    });
  });

  it('passes through an explicit "migration" payload unchanged in shape', () => {
    const input = {
      ...VALID_PAYLOAD,
      risk_level: 'migration' as const,
      migration: VALID_MIGRATION,
    };
    const parsed = parseWhatsNew(input);
    expect(parsed?.risk_level).toBe('migration');
    expect(parsed?.migration).toEqual(VALID_MIGRATION);
    expect(parsed?.backup_format_change).toBeNull();
  });

  it('passes through a "breaking" payload with all blocks populated', () => {
    const parsed = parseWhatsNew({
      ...VALID_PAYLOAD,
      risk_level: 'breaking',
      migration: VALID_MIGRATION,
      backup_format_change: VALID_BACKUP_CHANGE,
    });
    expect(parsed?.risk_level).toBe('breaking');
    expect(parsed?.migration).toEqual(VALID_MIGRATION);
    expect(parsed?.backup_format_change).toEqual(VALID_BACKUP_CHANGE);
  });
});

describe('fetchWhatsNew — network + parsing', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the parsed payload on a 200 OK, with missing fields normalized', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchWhatsNew();
    // The raw VALID_PAYLOAD has no risk fields; parseWhatsNew fills
    // them in so consumers can pattern-match safely without
    // re-implementing the fallback.
    expect(result).toEqual({
      ...VALID_PAYLOAD,
      risk_level: 'safe',
      migration: null,
      backup_format_change: null,
    });
  });

  it('returns null on a 404 (covers the deploy-without-file edge case)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('Not Found', { status: 404 }),
    ) as unknown as typeof globalThis.fetch;
    expect(await fetchWhatsNew()).toBeNull();
  });

  it('returns null on a network error (offline)', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    expect(await fetchWhatsNew()).toBeNull();
  });

  it('returns null when JSON is malformed', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('not really json {{{', { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    expect(await fetchWhatsNew()).toBeNull();
  });

  it('returns null when the payload fails the shape guard', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ version: '1.0' /* missing highlights */ }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    expect(await fetchWhatsNew()).toBeNull();
  });

  it('cache-busts the URL so the SW precache does not intercept', async () => {
    // Typed via the global fetch signature so .mock.calls[0] has the
    // right [input, init?] tuple shape for TypeScript.
    const fetchSpy = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }),
    );
    globalThis.fetch = fetchSpy;
    await fetchWhatsNew();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0]!;
    expect(String(input)).toMatch(/\/whats-new\.json\?_=\d+/);
    expect(init?.cache).toBe('no-store');
  });
});
