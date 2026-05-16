import { type Category } from '../types';
import { analyzeProductImageWithHF } from './ai-vision';
import { analyzeArticlePhoto, type PhotoAssistantSuggestion } from './photo-assistant';

function titleCase(input: string): string {
  return input.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function analyzeArticlePhotoWithVision(
  blob: Blob,
  allowedCategories: readonly Category[],
): Promise<PhotoAssistantSuggestion> {
  const base = await analyzeArticlePhoto(blob, allowedCategories);

  try {
    const vision = await analyzeProductImageWithHF(blob, allowedCategories);
    const category = base.category ?? vision.category;
    const name =
      base.name ??
      (vision.category && vision.confidence >= 0.4
        ? titleCase(`${base.color ? `${base.color} ` : ''}${vision.displayLabel}`)
        : null);

    return {
      ...base,
      category,
      name,
      confidence:
        base.confidence === 'high' || vision.confidence >= 0.72
          ? 'high'
          : base.confidence === 'medium' || vision.confidence >= 0.48
            ? 'medium'
            : 'low',
      vision: {
        enabled: true,
        backend: vision.backend,
        label: vision.displayLabel,
        category: vision.category,
        confidence: vision.confidence,
        rawLabels: vision.rawLabels,
      },
    };
  } catch (err) {
    console.warn('[Inventar AI] HF vision unavailable; using local photo assistant.', err);
    return {
      ...base,
      warnings: [...base.warnings, 'hf_unavailable'],
      vision: {
        enabled: false,
        backend: null,
        label: null,
        category: null,
        confidence: 0,
        rawLabels: [],
      },
    };
  }
}
