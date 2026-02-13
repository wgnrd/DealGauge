export type ListingSource = 'search' | 'detail';

export type Listing = {
  id: string;
  url: string;
  title: string | null;
  price_eur: number | null;
  price_history: Array<{ price_eur: number; captured_at: string }>;
  brand: string | null;
  model: string | null;
  trim: 'rs' | 'standard' | null;
  year: number | null;
  mileage_km: number | null;
  ps: number | null;
  erstzulassung: string | null;
  fuel: string | null;
  drivetrain: string | null;
  transmission: string | null;
  captured_at: string;
  source: ListingSource;
};

export type ListingsMap = Record<string, Listing>;

export type Analysis = {
  expected_price: number | null;
  diff_eur: number | null;
  diff_pct: number | null;
  deal_score: number | null;
  comparables_count: number;
  comparables: Listing[];
  not_enough_data: boolean;
};
