import { normalizeText } from './parse';
import type { Analysis, Listing, ListingsMap } from './types';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function findComparables(target: Listing, listings: ListingsMap): Listing[] {
  return Object.values(listings).filter((item) => {
    if (item.id === target.id) return false;
    if (!item.brand || !item.model || !target.brand || !target.model) return false;
    if (item.brand !== target.brand || item.model !== target.model) return false;
    if ((item.trim ?? null) !== (target.trim ?? null)) return false;

    if (item.drivetrain && target.drivetrain) {
      if (normalizeText(item.drivetrain) !== normalizeText(target.drivetrain)) return false;
    }

    if (item.year && target.year) {
      if (Math.abs(item.year - target.year) > 2) return false;
    }

    if (item.mileage_km && target.mileage_km) {
      const diff = Math.abs(item.mileage_km - target.mileage_km);
      const limit = target.mileage_km * 0.25;
      if (diff > limit) return false;
    }

    if (item.ps && target.ps) {
      if (item.ps !== target.ps) return false;
    }

    return item.price_eur !== null;
  });
}

export function analyzeListing(target: Listing, listings: ListingsMap): Analysis {
  const comparables = findComparables(target, listings);
  const prices = comparables
    .map((item) => item.price_eur)
    .filter((value): value is number => value !== null);
  const expected = median(prices);
  const ranked = [...comparables].sort((a, b) => {
    const yearDiffA = target.year && a.year ? Math.abs(target.year - a.year) : 10;
    const yearDiffB = target.year && b.year ? Math.abs(target.year - b.year) : 10;
    const mileageDiffA =
      target.mileage_km && a.mileage_km ? Math.abs(target.mileage_km - a.mileage_km) : 999999;
    const mileageDiffB =
      target.mileage_km && b.mileage_km ? Math.abs(target.mileage_km - b.mileage_km) : 999999;
    const psDiffA = target.ps && a.ps ? Math.abs(target.ps - a.ps) : 200;
    const psDiffB = target.ps && b.ps ? Math.abs(target.ps - b.ps) : 200;
    return (
      yearDiffA * 2 +
      mileageDiffA / 1000 +
      psDiffA / 10 -
      (yearDiffB * 2 + mileageDiffB / 1000 + psDiffB / 10)
    );
  });
  const notEnough = comparables.length < 10 || expected === null || target.price_eur === null;
  if (notEnough) {
    return {
      expected_price: expected,
      diff_eur: null,
      diff_pct: null,
      deal_score: null,
      comparables_count: comparables.length,
      comparables: ranked.slice(0, 5),
      not_enough_data: true,
    };
  }
  const diff = expected - target.price_eur;
  const diffPct = diff / expected;
  return {
    expected_price: expected,
    diff_eur: diff,
    diff_pct: diffPct,
    deal_score: diffPct,
    comparables_count: comparables.length,
    comparables: ranked.slice(0, 5),
    not_enough_data: false,
  };
}
