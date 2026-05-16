import { CANONICAL_COLOURS, type CanonicalColour } from '../query/colour-aliases';
import { type Category } from '../types';

export interface PhotoAssistantVision {
  enabled: boolean;
  backend: 'webgpu' | 'wasm' | null;
  label: string | null;
  category: Category | null;
  confidence: number;
  rawLabels: string[];
}

export interface PhotoAssistantSuggestion {
  color: CanonicalColour | null;
  colorScore: number;
  rawText: string;
  textSupported: boolean;
  brand: string | null;
  name: string | null;
  category: Category | null;
  size: string | null;
  material: string | null;
  confidence: 'low' | 'medium' | 'high';
  warnings: string[];
  vision?: PhotoAssistantVision | null;
}

interface TextDetectionResult {
  rawText: string;
  supported: boolean;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface TextDetectorCtor {
  new (): {
    detect: (
      source: Blob | ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    ) => Promise<Array<{ rawValue?: string }>>;
  };
}

const WORK_SIZE = 96;
const KNOWN_BRANDS = [
  'Nike',
  'Adidas',
  'Puma',
  'Reebok',
  'Jordan',
  'Converse',
  'Vans',
  'New Balance',
  'Asics',
  'Under Armour',
  'Lacoste',
  "Levi's",
  'Zara',
  'H&M',
  'Uniqlo',
  'Gucci',
  'Prada',
  'Chanel',
  'Dior',
  'Samsung',
  'Apple',
  'Xiaomi',
  'Huawei',
  'Nivea',
  "L'Oréal",
] as const;

const MODEL_PHRASES = [
  'Air Max',
  'Air Force',
  'Air Jordan',
  'Stan Smith',
  'Superstar',
  'Gazelle',
  'Ultraboost',
  'Old Skool',
  'Chuck Taylor',
  'Classic Leather',
] as const;

const MATERIAL_PATTERNS: Array<{ label: string; tokens: readonly string[] }> = [
  { label: 'leather', tokens: ['leather', 'cuir', 'جلد'] },
  { label: 'cotton', tokens: ['cotton', 'coton', 'قطن'] },
  { label: 'polyester', tokens: ['polyester', 'بوليستر'] },
  { label: 'denim', tokens: ['denim', 'jean', 'جينز'] },
  { label: 'wool', tokens: ['wool', 'laine', 'صوف'] },
  { label: 'silk', tokens: ['silk', 'soie', 'حرير'] },
  { label: 'rubber', tokens: ['rubber', 'caoutchouc', 'مطاط'] },
  { label: 'plastic', tokens: ['plastic', 'plastique', 'بلاستيك'] },
  { label: 'metal', tokens: ['metal', 'métal', 'metalique', 'معدن'] },
];

const CATEGORY_PATTERNS: Array<{ category: Category; tokens: readonly string[] }> = [
  {
    category: 'sport',
    tokens: [
      'shoe',
      'shoes',
      'sneaker',
      'sneakers',
      'trainer',
      'running',
      'basketball',
      'air max',
      'chaussure',
      'حذاء',
    ],
  },
  { category: 'shirts', tokens: ['shirt', 't-shirt', 'tee', 'chemise', 'قميص'] },
  { category: 'pants', tokens: ['pants', 'trousers', 'jeans', 'pantalon', 'بنطال'] },
  { category: 'dresses', tokens: ['dress', 'robe', 'فستان'] },
  {
    category: 'accessories',
    tokens: ['bag', 'belt', 'watch', 'cap', 'sac', 'ceinture', 'حقيبة', 'ساعة'],
  },
  { category: 'drinks', tokens: ['water', 'juice', 'cola', 'drink', 'boisson', 'ماء', 'عصير'] },
  {
    category: 'snacks',
    tokens: ['chips', 'biscuit', 'chocolate', 'snack', 'cookie', 'شيبس', 'بسكويت'],
  },
  {
    category: 'personal_care',
    tokens: ['cream', 'soap', 'shampoo', 'lotion', 'savon', 'كريم', 'شامبو'],
  },
  { category: 'household', tokens: ['detergent', 'cleaner', 'lessive', 'nettoyant', 'منظف'] },
];

const COLOR_TARGETS: Record<CanonicalColour, RGB> = {
  white: { r: 245, g: 245, b: 240 },
  black: { r: 22, g: 22, b: 24 },
  gray: { r: 135, g: 135, b: 135 },
  brown: { r: 126, g: 78, b: 43 },
  beige: { r: 214, g: 190, b: 150 },
  red: { r: 198, g: 42, b: 45 },
  orange: { r: 230, g: 126, b: 34 },
  yellow: { r: 235, g: 204, b: 55 },
  green: { r: 65, g: 150, b: 80 },
  blue: { r: 50, g: 105, b: 210 },
  navy: { r: 25, g: 45, b: 95 },
  purple: { r: 128, g: 75, b: 160 },
  pink: { r: 228, g: 110, b: 165 },
  gold: { r: 212, g: 165, b: 55 },
  silver: { r: 185, g: 190, b: 195 },
  multi: { r: 128, g: 128, b: 128 },
};

function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesToken(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(normalizeText(needle).toLowerCase());
}

function distance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function colourfulness(a: RGB): number {
  const max = Math.max(a.r, a.g, a.b);
  const min = Math.min(a.r, a.g, a.b);
  return max - min;
}

function nearestCanonicalColour(rgb: RGB): { color: CanonicalColour; score: number } {
  let best: CanonicalColour = 'gray';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const color of CANONICAL_COLOURS) {
    if (color === 'multi') continue;
    const d = distance(rgb, COLOR_TARGETS[color]);
    if (d < bestDistance) {
      best = color;
      bestDistance = d;
    }
  }
  const score = Math.max(0, Math.min(1, 1 - bestDistance / 330));
  return { color: best, score };
}

async function drawBlob(blob: Blob): Promise<{ canvas: HTMLCanvasElement; cleanup: () => void }> {
  const canvas = document.createElement('canvas');
  canvas.width = WORK_SIZE;
  canvas.height = WORK_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available');

  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob);
    try {
      ctx.drawImage(bitmap, 0, 0, WORK_SIZE, WORK_SIZE);
      return { canvas, cleanup: () => bitmap.close() };
    } catch (err) {
      bitmap.close();
      throw err;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, WORK_SIZE, WORK_SIZE);
    return { canvas, cleanup: () => URL.revokeObjectURL(url) };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export async function extractDominantColour(
  blob: Blob,
): Promise<{ color: CanonicalColour; score: number; rgb: RGB }> {
  const { canvas, cleanup } = await drawBlob(blob);
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas is not available');
    const { data } = ctx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
    const samples: RGB[] = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const avg = (r + g + b) / 3;
      // Skip the most common photo backgrounds: blown whites, deep shadows,
      // and extremely flat grays. Neutral products still fall back below.
      if (avg > 242 || avg < 18) continue;
      if (colourfulness({ r, g, b }) < 18 && samples.length > 25) continue;
      samples.push({ r, g, b });
    }

    const source = samples.length > 0 ? samples : [{ r: 128, g: 128, b: 128 }];
    const rgb = source.reduce(
      (acc, item) => ({ r: acc.r + item.r, g: acc.g + item.g, b: acc.b + item.b }),
      { r: 0, g: 0, b: 0 },
    );
    rgb.r = Math.round(rgb.r / source.length);
    rgb.g = Math.round(rgb.g / source.length);
    rgb.b = Math.round(rgb.b / source.length);

    return { ...nearestCanonicalColour(rgb), rgb };
  } finally {
    cleanup();
  }
}

async function detectText(blob: Blob): Promise<TextDetectionResult> {
  const maybeWindow = globalThis as unknown as { TextDetector?: TextDetectorCtor };
  const Detector = maybeWindow.TextDetector;
  if (!Detector) return { rawText: '', supported: false };

  try {
    const detector = new Detector();
    const rows = await detector.detect(blob);
    return {
      rawText: normalizeText(rows.map((row) => row.rawValue ?? '').join(' ')),
      supported: true,
    };
  } catch (err) {
    console.warn('Photo text detection failed', err);
    return { rawText: '', supported: true };
  }
}

export function inferBrand(rawText: string): string | null {
  const text = normalizeText(rawText);
  for (const brand of KNOWN_BRANDS) {
    if (includesToken(text, brand)) return brand;
  }
  return null;
}

export function inferSize(rawText: string): string | null {
  const text = normalizeText(rawText);
  const patterns = [
    /(?:EU|EUR|SIZE|TAILLE|POINTURE)\s*[:#-]?\s*(\d{2}(?:\.5)?)/i,
    /\b(3[5-9]|4[0-9]|5[0-2])\b/,
    /\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i,
    /\b(\d{1,2}\s?(?:M|Y))\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, '').toUpperCase();
  }
  return null;
}

export function inferMaterial(rawText: string): string | null {
  const text = normalizeText(rawText).toLowerCase();
  for (const item of MATERIAL_PATTERNS) {
    if (item.tokens.some((token) => text.includes(normalizeText(token).toLowerCase()))) {
      return item.label;
    }
  }
  return null;
}

export function inferCategory(
  rawText: string,
  allowedCategories: readonly Category[],
): Category | null {
  const text = normalizeText(rawText).toLowerCase();
  for (const item of CATEGORY_PATTERNS) {
    if (!allowedCategories.includes(item.category)) continue;
    if (item.tokens.some((token) => text.includes(normalizeText(token).toLowerCase()))) {
      return item.category;
    }
  }
  return null;
}

function inferModel(rawText: string): string | null {
  const text = normalizeText(rawText);
  for (const phrase of MODEL_PHRASES) {
    if (includesToken(text, phrase)) return phrase;
  }
  return null;
}

export function inferName(input: {
  rawText: string;
  brand: string | null;
  category: Category | null;
  color: CanonicalColour | null;
}): string | null {
  const model = inferModel(input.rawText);
  if (input.brand && model) return `${input.brand} ${model}`;
  if (input.brand && input.category) return `${input.brand} ${input.category}`;
  if (model) return model;
  if (input.color && input.category) return `${input.color} ${input.category}`;
  return null;
}

export async function analyzeArticlePhoto(
  blob: Blob,
  allowedCategories: readonly Category[],
): Promise<PhotoAssistantSuggestion> {
  const warnings: string[] = [];
  const [colour, text] = await Promise.all([extractDominantColour(blob), detectText(blob)]);
  if (!text.supported) warnings.push('text_unsupported');
  const brand = inferBrand(text.rawText);
  const size = inferSize(text.rawText);
  const material = inferMaterial(text.rawText);
  const category = inferCategory(text.rawText, allowedCategories);
  const name = inferName({ rawText: text.rawText, brand, category, color: colour.color });

  const evidenceCount = [brand, size, material, category, name].filter(Boolean).length;
  const confidence: PhotoAssistantSuggestion['confidence'] =
    text.rawText && evidenceCount >= 3
      ? 'high'
      : text.rawText || colour.score >= 0.72
        ? 'medium'
        : 'low';

  return {
    color: colour.color,
    colorScore: colour.score,
    rawText: text.rawText,
    textSupported: text.supported,
    brand,
    name,
    category,
    size,
    material,
    confidence,
    warnings,
  };
}
