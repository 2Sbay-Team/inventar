import type { ExportRowsV1 } from './format-v1';

// Deterministic JSON: object keys are emitted in lexicographic order, arrays
// preserved as-is, primitives as JSON.stringify. Two callers serialise the
// same row tree to byte-identical strings — that's what makes the integrity
// hash reproducible across export → re-export.

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(',')}}`;
}

// Computes the SHA-256 digest of the canonical-stringified rows tree, hex
// encoded. Web Crypto is the only allowed crypto path here — it works in
// every modern browser AND in Node 20+ (globalThis.crypto.subtle), which is
// what the unit tests rely on.
export async function integrityHash(rows: ExportRowsV1): Promise<string> {
  const data = new TextEncoder().encode(canonicalStringify(rows));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
