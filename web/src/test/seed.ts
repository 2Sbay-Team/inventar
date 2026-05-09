import { db, DB_NAME } from '../db/db';
import { upsertProfile } from '../repos/profile';
import { setMeta, META_KEYS } from '../repos/meta';
import { createArticle } from '../repos/articles';
import { storePhoto } from '../repos/photos';
import { recordMovement } from '../repos/movements';
import { addExpense } from '../repos/expenses';
import { type Locale } from '../types';
import { setLocale } from '../i18n/i18next';

// Test-only seed surface. Mounted on `window` ONLY when the bundle was built
// with VITE_E2E=true (see vite.config + playwright webServer). Production
// builds never see this code, so a real user's device cannot accidentally
// invoke __inventarSeed and trash their data.

interface SeedArticleInput {
  name: string;
  colors?: string[];
  brand?: string | null;
  category?: 'sport' | 'dress' | 'casual' | 'kids' | 'women' | 'men';
  cost_tnd?: number; // millimes
  sale_tnd?: number; // millimes
  sizes?: Array<{ size: string; qty: number }>;
  // Tiny PNG bytes (base64) to attach as a photo. Optional.
  photoB64?: string;
  archived?: boolean;
}

interface SeedInput {
  shopName?: string;
  locale?: Locale;
  articles?: SeedArticleInput[];
  expenses?: Array<{ category: string; amount_tnd: number; at?: string }>;
  // Force-clear IndexedDB before applying. Default true.
  reset?: boolean;
}

async function clearAllTables(): Promise<void> {
  await Promise.all([
    db.profile.clear(),
    db.articles.clear(),
    db.variants.clear(),
    db.movements.clear(),
    db.expenses.clear(),
    db.photos.clear(),
    db.meta.clear(),
  ]);
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function applySeed(input: SeedInput): Promise<void> {
  if (input.reset !== false) await clearAllTables();
  const locale: Locale = input.locale ?? 'fr';
  await upsertProfile(db, { name: input.shopName ?? 'Test Shop', locale });
  await setMeta(db, META_KEYS.locale, locale);
  await setMeta(db, META_KEYS.persistence_requested, true);
  await setLocale(locale);

  for (const a of input.articles ?? []) {
    let photoId: string | null = null;
    if (a.photoB64) {
      const bytes = decodeBase64(a.photoB64);
      const blob = new Blob([bytes], { type: 'image/jpeg' });
      const stored = await storePhoto(db, {
        blob,
        width: 100,
        height: 100,
        mime: 'image/jpeg',
      });
      photoId = stored.id;
    }
    const sizes = a.sizes ?? [];
    const created = await createArticle(db, {
      name: a.name,
      photo_id: photoId,
      category: a.category ?? 'sport',
      colors: a.colors ?? [],
      brand: a.brand ?? null,
      cost_price_tnd: a.cost_tnd ?? 30000,
      sale_price_tnd: a.sale_tnd ?? 60000,
      notes: null,
      sizes: sizes.map(({ size, qty }) => ({ size, initial_qty: qty })),
    });
    if (a.archived) {
      const ts = new Date().toISOString();
      await db.articles.put({ ...created.article, archived_at: ts, updated_at: ts });
    }
  }

  for (const e of input.expenses ?? []) {
    await addExpense(db, {
      category: e.category as never,
      amount_tnd: e.amount_tnd,
      note: null,
      at: e.at ?? new Date().toISOString(),
      recurring: 'none',
    });
  }
}

async function sellOne(articleName: string, size: string): Promise<void> {
  const article = (await db.articles.toArray()).find((a) => a.name === articleName);
  if (!article) throw new Error(`seed: article not found: ${articleName}`);
  const variant = await db.variants.where('[article_id+size]').equals([article.id, size]).first();
  if (!variant) throw new Error(`seed: variant not found ${articleName}/${size}`);
  await recordMovement(db, { variant_id: variant.id, delta: -1, type: 'sale', note: null });
}

async function deleteAll(): Promise<void> {
  await clearAllTables();
}

async function deleteDb(): Promise<void> {
  db.close();
  await indexedDB.deleteDatabase(DB_NAME);
}

interface SeedAPI {
  seed: (input: SeedInput) => Promise<void>;
  sellOne: (articleName: string, size: string) => Promise<void>;
  reset: () => Promise<void>;
  deleteDb: () => Promise<void>;
}

declare global {
  interface Window {
    __inventarSeed?: SeedAPI;
  }
}

export function mountTestSeed(): void {
  if (typeof window === 'undefined') return;
  if (!import.meta.env.VITE_E2E) return;
  const api: SeedAPI = {
    seed: applySeed,
    sellOne,
    reset: deleteAll,
    deleteDb,
  };
  window.__inventarSeed = api;
}
