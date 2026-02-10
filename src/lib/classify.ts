import { normalizeText } from './parse';

function tokenBoundaryRegex(token: string): RegExp {
  return new RegExp(`(^|\\b)${token}(\\b|$)`, 'i');
}

export type Classified = {
  brand: string | null;
  model: string | null;
  trim: 'rs' | 'standard' | null;
};

export function classifyFromTitle(title: string | null): Classified {
  if (!title) return { brand: null, model: null, trim: null };
  const normalized = normalizeText(title);
  const hasSkoda = /\bskoda\b/i.test(normalized);
  const hasOctavia = /\boctavia\b/i.test(normalized);
  if (hasSkoda && hasOctavia) {
    const isRs =
      tokenBoundaryRegex('rs').test(normalized) ||
      tokenBoundaryRegex('vrs').test(normalized) ||
      /\boctavia\s+rs\b/i.test(normalized);
    return {
      brand: 'skoda',
      model: 'octavia',
      trim: isRs ? 'rs' : 'standard',
    };
  }
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const brand = tokens[0] ?? null;
  const model = tokens[1] ?? null;
  return { brand, model, trim: null };
}
