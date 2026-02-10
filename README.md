
# DealGauge (Used‑Car Deal Evaluator)

![DealGauge logo](./logo.png)

DealGauge is a Manifest V3 browser extension built with WXT + Svelte that helps you evaluate used‑car listings on a popular austrian car marketplace.  
It only analyzes pages you personally view in the browser — no crawling, no background scraping, no automated fetching.


## What It Does

- Captures listings from:
  - Search result pages (listings)
  - Detail pages (`/iad/.../d/...`)
- Stores all captured listings locally (extension storage).
- Computes a local “expected price” from comparable cars you’ve already seen.
- Shows deal insights in:
  - The extension popup
  - A floating on‑page panel on detail pages
  - Price badges on listing cards

## Key Features

- **Comparable logic (v1)**
  - Same brand + model + trim bucket
  - Year within ±2 (if both exist)
  - Mileage within ±25% (if both exist)
  - Expected price = median of comparable prices
  - Deal score = (expected − price) / expected
  - If < 10 comparables → “Not enough data”
- **Price history**
  - Tracks changes per listing over time
- **Export**
  - JSON and CSV export from the popup
- **Badges**
  - Listing cards show “Great / Good / Fair / Overpriced”
  - Tooltip includes expected price, diff %, comparables count
- **Floating panel**
  - Drag‑and‑drop positioning, persisted across pages

## Dev‑Only Usage (not in extension stores)

### 1) Install dependencies

```sh
pnpm install
```

### 2) Run in development mode

Chrome/Chromium:
```sh
pnpm run dev
```

Firefox:
```sh
pnpm run dev:firefox
```

### 3) Use the extension

1. Open listings pages, e.g.  

2. Open detail pages, e.g.  

3. You will see:
   - Listing badges next to prices
   - A floating DealGauge panel on detail pages
   - Popup analysis when you open the extension

The extension only learns from pages you view, so accuracy improves as you browse more listings.

## Data Model (stored locally)

- `id` (canonical URL without query)
- `url`
- `title`
- `price_eur`
- `price_history`
- `brand`, `model`, `trim`
- `year`, `mileage_km`
- `captured_at`
- `source` (`search` or `detail`)

## Build / Package

```sh
pnpm run build
pnpm run zip
```


## Notes

- No external data sources are used.
- No automated crawling.
- All computation is local in the extension.
l