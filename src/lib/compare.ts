import { canonicalizeUrl, normalizeText } from './parse';
import { defaultAnalysisFilters } from './types';
import type { Analysis, AnalysisFilters, Listing, ListingsMap } from './types';

const MIN_COMPARABLES_FOR_WEIGHTED_ESTIMATE = 10;
const TRIM_PERCENT = 0.1;

function extractNumericListingId(value: string | null | undefined): string | null {
  if (!value) return null;
  const matches = value.match(/\d{6,}/g);
  if (!matches?.length) return null;
  return matches[matches.length - 1] ?? null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function trimPriceOutliers(listings: Listing[]): Listing[] {
  if (listings.length < MIN_COMPARABLES_FOR_WEIGHTED_ESTIMATE) return listings;

  const sorted = [...listings].sort((a, b) => (a.price_eur ?? 0) - (b.price_eur ?? 0));
  const trimCount = Math.floor(sorted.length * TRIM_PERCENT);
  if (trimCount === 0) return sorted;
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  return trimmed.length > 0 ? trimmed : sorted;
}

function listingDistanceWeight(target: Listing, comparable: Listing): number {
  const yearDistance =
    target.year !== null && comparable.year !== null ? Math.abs(target.year - comparable.year) : 2;
  const mileageDistanceRatio =
    target.mileage_km !== null && comparable.mileage_km !== null
      ? Math.abs(target.mileage_km - comparable.mileage_km) / Math.max(target.mileage_km, 1)
      : 0.25;
  return 1 / (1 + yearDistance + mileageDistanceRatio * 4);
}

function weightedExpectedPrice(target: Listing, comparables: Listing[]): number | null {
  if (comparables.length === 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  for (const comparable of comparables) {
    if (comparable.price_eur === null) continue;
    const weight = listingDistanceWeight(target, comparable);
    weightedSum += comparable.price_eur * weight;
    weightTotal += weight;
  }

  if (weightTotal === 0) {
    return median(
      comparables.map((item) => item.price_eur).filter((value): value is number => value !== null),
    );
  }
  return weightedSum / weightTotal;
}

function matchesStrictAttribute(targetValue: string | null, comparableValue: string | null): boolean {
  if (!targetValue || !comparableValue) return false;
  return normalizeText(targetValue) === normalizeText(comparableValue);
}

function matchesActiveFilters(target: Listing, comparable: Listing, filters: AnalysisFilters): boolean {
  const hasTechnicalFilter = filters.matchFuel || filters.matchDrivetrain || filters.matchTransmission;
  if (hasTechnicalFilter && comparable.source !== 'detail') return false;
  if (filters.matchFuel && !matchesStrictAttribute(target.fuel, comparable.fuel)) return false;
  if (filters.matchDrivetrain && !matchesStrictAttribute(target.drivetrain, comparable.drivetrain)) return false;
  if (filters.matchTransmission && !matchesStrictAttribute(target.transmission, comparable.transmission)) return false;
  return true;
}

export function findComparables(target: Listing, listings: ListingsMap, filters?: AnalysisFilters): Listing[] {
  const activeFilters = filters ?? defaultAnalysisFilters();
  const targetCanonicalUrl = canonicalizeUrl(target.url ?? '');
  const targetNumericId = extractNumericListingId(target.id) ?? extractNumericListingId(target.url);
  return Object.values(listings).filter((item) => {
    if (item.id === target.id) return false;
    if (item.url && target.url && canonicalizeUrl(item.url) === targetCanonicalUrl) return false;
    const itemNumericId = extractNumericListingId(item.id) ?? extractNumericListingId(item.url);
    if (itemNumericId && targetNumericId && itemNumericId === targetNumericId) return false;
    if (!item.brand || !item.model || !target.brand || !target.model) return false;
    if (item.brand !== target.brand || item.model !== target.model) return false;
    if ((item.trim ?? null) !== (target.trim ?? null)) return false;
    if (!matchesActiveFilters(target, item, activeFilters)) return false;

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

export function analyzeListing(target: Listing, listings: ListingsMap, filters?: AnalysisFilters): Analysis {
  const appliedFilters = filters ?? defaultAnalysisFilters();
  const comparables = findComparables(target, listings, appliedFilters);
  const pricedComparables = comparables.filter((item): item is Listing & { price_eur: number } => item.price_eur !== null);
  const prices = pricedComparables
    .map((item) => item.price_eur)
    .filter((value): value is number => value !== null);
  const sparseData = comparables.length < MIN_COMPARABLES_FOR_WEIGHTED_ESTIMATE;
  const estimateBase = sparseData ? pricedComparables : trimPriceOutliers(pricedComparables);
  const expected = sparseData ? median(prices) : weightedExpectedPrice(target, estimateBase);
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
  const notEnough = sparseData || expected === null || target.price_eur === null;
  if (notEnough) {
    return {
      expected_price: expected,
      diff_eur: null,
      diff_pct: null,
      deal_score: null,
      comparables_count: comparables.length,
      comparables: ranked.slice(0, 5),
      not_enough_data: true,
      applied_filters: appliedFilters,
    };
  }
  const targetPrice = target.price_eur as number;
  const diff = expected - targetPrice;
  const diffPct = diff / expected;
  return {
    expected_price: expected,
    diff_eur: diff,
    diff_pct: diffPct,
    deal_score: diffPct,
    comparables_count: comparables.length,
    comparables: ranked.slice(0, 5),
    not_enough_data: false,
    applied_filters: appliedFilters,
  };
}
