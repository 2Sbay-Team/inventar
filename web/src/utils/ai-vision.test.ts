import { describe, expect, it } from 'vitest';
import { mapVisionLabelToCategory, visionCandidateLabels } from './ai-vision';

describe('ai-vision mapping', () => {
  it('maps SigLIP candidate labels to Inventar categories when allowed', () => {
    expect(mapVisionLabelToCategory('sneaker', ['sport', 'shirts'])).toBe('sport');
    expect(mapVisionLabelToCategory('t-shirt', ['sport', 'shirts'])).toBe('shirts');
  });

  it('does not return a category that is not allowed for the shop profile', () => {
    expect(mapVisionLabelToCategory('sneaker', ['drinks'])).toBeNull();
  });

  it('keeps candidate labels available for zero-shot classification', () => {
    expect(visionCandidateLabels()).toContain('sneaker');
    expect(visionCandidateLabels()).toContain('other product');
  });
});
