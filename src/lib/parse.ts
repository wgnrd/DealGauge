import type { Listing } from './types';

export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return rawUrl.split('#')[0]?.split('?')[0] ?? rawUrl;
  }
}

export function parsePriceEur(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\s/g, '')
    .replace(/[^\d.,€]/g, '')
    .replace(/€/, '');
  const match = cleaned.match(/(\d{1,3}([.,]\d{3})+|\d{4,7})/);
  if (!match) return null;
  const numeric = match[0].replace(/[.,]/g, '');
  const value = Number.parseInt(numeric, 10);
  return Number.isFinite(value) ? value : null;
}

function clampYear(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value >= 1980 && value <= 2035 ? value : null;
}

export function parseYear(text: string | null): number | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  const ezMatch = lower.match(/(?:ez|erstzulassung)[^0-9]*(\d{1,2}[./-])?(\d{4})/i);
  if (ezMatch?.[2]) {
    return clampYear(Number.parseInt(ezMatch[2], 10));
  }
  const monthYearMatch = lower.match(/\b(\d{1,2}[./-])(\d{4})\b/);
  if (monthYearMatch?.[2]) {
    return clampYear(Number.parseInt(monthYearMatch[2], 10));
  }
  const match = text.match(/\b(19[8-9]\d|20[0-2]\d|203[0-5])\b/);
  if (!match) return null;
  return clampYear(Number.parseInt(match[1], 10));
}

export function parseMileageKm(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d{1,3}([.,]\d{3})+|\d{4,6})\s*km/i);
  if (!match) return null;
  const numeric = match[1].replace(/[.,]/g, '');
  const value = Number.parseInt(numeric, 10);
  return Number.isFinite(value) ? value : null;
}

export function parsePowerPs(text: string | null): number | null {
  if (!text) return null;
  const directMatch = text.match(/(\d{2,4})\s*ps\b/i);
  if (directMatch?.[1]) {
    const value = Number.parseInt(directMatch[1], 10);
    return Number.isFinite(value) ? value : null;
  }
  const labelMatch = text.match(/ps[^0-9]{0,6}(\d{2,4})/i);
  if (!labelMatch?.[1]) return null;
  const value = Number.parseInt(labelMatch[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function normalizeText(text: string | null): string {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}

export function extractTextCandidates(root: ParentNode, selector: string): string[] {
  return Array.from(root.querySelectorAll(selector))
    .map((el) => (el as HTMLElement).innerText?.trim())
    .filter((value): value is string => Boolean(value));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function mergeListing(existing: Listing | undefined, incoming: Listing): Listing {
  if (!existing) return incoming;
  const prefer = <T>(current: T | null, next: T | null) => (next ?? current);
  const isDetail = incoming.source === 'detail';
  const history = [...(existing.price_history ?? [])];
  if (incoming.price_eur !== null) {
    const last = history[history.length - 1];
    if (!last || last.price_eur !== incoming.price_eur) {
      history.push({ price_eur: incoming.price_eur, captured_at: incoming.captured_at });
    }
  }
  return {
    ...existing,
    url: incoming.url || existing.url,
    title: prefer(existing.title, incoming.title),
    price_eur: prefer(existing.price_eur, incoming.price_eur),
    price_history: history,
    brand: prefer(existing.brand, incoming.brand),
    model: prefer(existing.model, incoming.model),
    trim: prefer(existing.trim, incoming.trim),
    year: prefer(existing.year, incoming.year),
    mileage_km: prefer(existing.mileage_km, incoming.mileage_km),
    ps: prefer(existing.ps, incoming.ps),
    captured_at: incoming.captured_at,
    source: isDetail ? 'detail' : existing.source,
  };
}
