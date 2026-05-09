import { db } from '../db/db';
import { getProfile } from '../repos/profile';
import { type ShopProfile } from '../types';
import { useLive } from './use-live';

// Subscribes to the singleton ShopProfile row. `undefined` while loading,
// `null` once we've confirmed the row doesn't exist (onboarding not done).
export function useProfile(): ShopProfile | null | undefined {
  return useLive<ShopProfile | null>(async () => (await getProfile(db)) ?? null, []);
}
