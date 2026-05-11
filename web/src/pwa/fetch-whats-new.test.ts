import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWhatsNew, isValidWhatsNew } from './fetch-whats-new';

// v0.6 ADR-030 — unit tests for the whats-new.json fetcher.

const VALID_PAYLOAD = {
  version: '0.6.0',
  released_at: '2026-06-01',
  highlights: {
    en: ['One', 'Two'],
    fr: ['Un', 'Deux'],
    ar: ['واحد', 'اثنان'],
  },
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

  it('returns the parsed payload on a 200 OK', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    const result = await fetchWhatsNew();
    expect(result).toEqual(VALID_PAYLOAD);
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
