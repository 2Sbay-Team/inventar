import {
  env,
  pipeline,
  type ZeroShotImageClassificationOutput,
  type ZeroShotImageClassificationPipeline,
} from '@huggingface/transformers';
import { type Category } from '../types';

const MODEL_ID = 'Xenova/siglip-base-patch16-256';
const AI_WORK_SIZE = 256;

interface CategoryCandidate {
  label: string;
  category: Category | null;
  nameHint: string;
}

const CANDIDATES: readonly CategoryCandidate[] = [
  { label: 'shoe', category: 'sport', nameHint: 'shoe' },
  { label: 'sneaker', category: 'sport', nameHint: 'sneaker' },
  { label: 'boot', category: 'sport', nameHint: 'boot' },
  { label: 'sports shoe', category: 'sport', nameHint: 'sports shoe' },
  { label: 'shirt', category: 'shirts', nameHint: 'shirt' },
  { label: 't-shirt', category: 'shirts', nameHint: 't-shirt' },
  { label: 'top', category: 'shirts', nameHint: 'top' },
  { label: 'pants', category: 'pants', nameHint: 'pants' },
  { label: 'jeans', category: 'pants', nameHint: 'jeans' },
  { label: 'dress', category: 'dresses', nameHint: 'dress' },
  { label: 'skirt', category: 'dresses', nameHint: 'skirt' },
  { label: 'handbag', category: 'accessories', nameHint: 'handbag' },
  { label: 'backpack', category: 'accessories', nameHint: 'backpack' },
  { label: 'watch', category: 'accessories', nameHint: 'watch' },
  { label: 'bottle', category: 'drinks', nameHint: 'bottle' },
  { label: 'can drink', category: 'drinks', nameHint: 'drink' },
  { label: 'juice box', category: 'drinks', nameHint: 'juice' },
  { label: 'snack', category: 'snacks', nameHint: 'snack' },
  { label: 'chocolate bar', category: 'snacks', nameHint: 'chocolate' },
  { label: 'biscuit pack', category: 'snacks', nameHint: 'biscuit' },
  { label: 'soap', category: 'personal_care', nameHint: 'soap' },
  { label: 'shampoo bottle', category: 'personal_care', nameHint: 'shampoo' },
  { label: 'skin cream', category: 'personal_care', nameHint: 'cream' },
  { label: 'household cleaner', category: 'household', nameHint: 'cleaner' },
  { label: 'detergent bottle', category: 'household', nameHint: 'detergent' },
  { label: 'notebook', category: 'stationery', nameHint: 'notebook' },
  { label: 'pen', category: 'stationery', nameHint: 'pen' },
  { label: 'paper product', category: 'stationery', nameHint: 'paper' },
  { label: 'electronics accessory', category: 'electronics', nameHint: 'electronics accessory' },
  { label: 'phone accessory', category: 'electronics', nameHint: 'phone accessory' },
  { label: 'toy', category: 'toys', nameHint: 'toy' },
  { label: 'other product', category: null, nameHint: 'product' },
] as const;

export interface VisionAIStatus {
  modelId: string;
  backend: 'webgpu' | 'wasm';
  cached: boolean;
}

export interface VisionAIResult {
  category: Category | null;
  displayLabel: string;
  confidence: number;
  backend: VisionAIStatus['backend'];
  rawLabels: string[];
}

let classifier: ZeroShotImageClassificationPipeline | null = null;
let activeBackend: VisionAIStatus['backend'] | null = null;

function configureTransformersEnv(): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  // Browser Cache API. After the first successful model download, the model
  // can be reused offline by Transformers.js where the browser cache is kept.
  env.useBrowserCache = true;
}

function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function createDownscaledCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = AI_WORK_SIZE;
  canvas.height = AI_WORK_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  if (!ctx) throw new Error('Canvas is not available');

  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: AI_WORK_SIZE,
      resizeHeight: AI_WORK_SIZE,
      resizeQuality: 'medium',
    });
    try {
      ctx.drawImage(bitmap, 0, 0, AI_WORK_SIZE, AI_WORK_SIZE);
    } finally {
      bitmap.close();
    }
    return canvas;
  }

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    ctx.drawImage(image, 0, 0, AI_WORK_SIZE, AI_WORK_SIZE);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type ZeroShotPipelineFactory = (
  task: 'zero-shot-image-classification',
  model: string,
  options: { device: VisionAIStatus['backend']; dtype: 'q8' },
) => Promise<ZeroShotImageClassificationPipeline>;

const createZeroShotPipeline = pipeline as unknown as ZeroShotPipelineFactory;

async function loadPipelineForBackend(
  backend: VisionAIStatus['backend'],
): Promise<ZeroShotImageClassificationPipeline> {
  return createZeroShotPipeline('zero-shot-image-classification', MODEL_ID, {
    device: backend,
    dtype: 'q8',
  });
}

export async function initVisionAI(): Promise<VisionAIStatus> {
  if (classifier && activeBackend) {
    return { modelId: MODEL_ID, backend: activeBackend, cached: true };
  }

  configureTransformersEnv();
  const preferred: VisionAIStatus['backend'] = hasWebGPU() ? 'webgpu' : 'wasm';
  try {
    classifier = await loadPipelineForBackend(preferred);
    activeBackend = preferred;
  } catch (err) {
    if (preferred === 'wasm') throw err;
    console.warn('[Inventar AI] WebGPU failed; falling back to WASM.', err);
    classifier = await loadPipelineForBackend('wasm');
    activeBackend = 'wasm';
  }

  return { modelId: MODEL_ID, backend: activeBackend, cached: true };
}

function normalisePipelineOutput(
  output: ZeroShotImageClassificationOutput[] | ZeroShotImageClassificationOutput[][],
): ZeroShotImageClassificationOutput[] {
  if (Array.isArray(output[0])) return output[0] as ZeroShotImageClassificationOutput[];
  return output as ZeroShotImageClassificationOutput[];
}

function categoryForLabel(label: string, allowedCategories: readonly Category[]): Category | null {
  const candidate = CANDIDATES.find((item) => item.label === label);
  if (!candidate?.category) return null;
  return allowedCategories.includes(candidate.category) ? candidate.category : null;
}

function displayLabelFor(label: string): string {
  return CANDIDATES.find((item) => item.label === label)?.nameHint ?? label;
}

export function mapVisionLabelToCategory(
  label: string,
  allowedCategories: readonly Category[],
): Category | null {
  return categoryForLabel(label, allowedCategories);
}

export function visionCandidateLabels(): string[] {
  return CANDIDATES.map((item) => item.label);
}

export async function analyzeProductImageWithHF(
  blob: Blob,
  allowedCategories: readonly Category[],
): Promise<VisionAIResult> {
  await initVisionAI();
  if (!classifier || !activeBackend) throw new Error('Vision AI is not available');

  const canvas = await createDownscaledCanvas(blob);
  const labels = visionCandidateLabels();
  const output = await classifier(canvas, labels, {
    hypothesis_template: 'This is a product photo of {}.',
  });
  const results = normalisePipelineOutput(output)
    .filter((item) => typeof item.label === 'string' && Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);

  const topWithCategory = results.find((item) => categoryForLabel(item.label, allowedCategories));
  const top = topWithCategory ?? results[0];
  if (!top) {
    return {
      category: null,
      displayLabel: 'product',
      confidence: 0,
      backend: activeBackend,
      rawLabels: [],
    };
  }

  return {
    category: categoryForLabel(top.label, allowedCategories),
    displayLabel: displayLabelFor(top.label),
    confidence: top.score,
    backend: activeBackend,
    rawLabels: results.slice(0, 5).map((item) => item.label),
  };
}
