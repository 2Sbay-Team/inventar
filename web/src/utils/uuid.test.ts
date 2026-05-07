import { describe, expect, it } from 'vitest';
import { newUUID } from './uuid';

describe('newUUID', () => {
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('returns a string in RFC4122 v4 format', () => {
    const id = newUUID();
    expect(id).toMatch(UUID_V4);
  });

  it('returns a unique value on each call', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(newUUID());
    expect(ids.size).toBe(1000);
  });
});
