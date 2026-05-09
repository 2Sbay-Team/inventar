import { type Page } from '@playwright/test';
import { type Locale } from '../../src/types';

interface SeedArticle {
  name: string;
  colors?: string[];
  brand?: string | null;
  category?: 'sport' | 'dress' | 'casual' | 'kids' | 'women' | 'men';
  cost_tnd?: number;
  sale_tnd?: number;
  sizes?: Array<{ size: string; qty: number }>;
  archived?: boolean;
}

export interface SeedFreshOptions {
  shopName?: string;
  locale?: Locale;
  articles?: SeedArticle[];
}

// Plants a fresh DB state for a test. The page must already be on a route
// where the seed surface has loaded; we navigate to '/' first.
export async function seedFresh(page: Page, options: SeedFreshOptions): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__inventarSeed));
  await page.evaluate(async (input) => {
    await window.__inventarSeed!.seed({
      shopName: input.shopName ?? 'Test Shop',
      locale: input.locale ?? 'fr',
      articles: input.articles ?? [],
      reset: true,
    });
  }, options);
  // Reload so the freshly-seeded profile/articles drive the live queries.
  await page.reload();
}

// The standard catalogue used by spec 15. Three colours, two sizes, one
// archived to test ordering.
export const standardCatalogue: SeedArticle[] = [
  {
    name: 'White running shoe',
    colors: ['white'],
    brand: 'Lotto',
    category: 'sport',
    cost_tnd: 38_000,
    sale_tnd: 68_000,
    sizes: [
      { size: '40', qty: 1 },
      { size: '42', qty: 2 },
    ],
  },
  {
    name: 'Brown leather boot',
    colors: ['brown'],
    brand: null,
    category: 'casual',
    cost_tnd: 50_000,
    sale_tnd: 95_000,
    sizes: [{ size: '40', qty: 1 }],
  },
  {
    name: 'Black classic loafer',
    colors: ['black'],
    brand: null,
    category: 'dress',
    cost_tnd: 60_000,
    sale_tnd: 110_000,
    sizes: [{ size: '42', qty: 3 }],
  },
];
