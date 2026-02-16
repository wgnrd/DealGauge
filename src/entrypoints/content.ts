import { classifyFromTitle } from '../lib/classify';
import {
  canonicalizeUrl,
  extractTextCandidates,
  nowIso,
  parseMileageKm,
  parsePowerPs,
  parsePriceEur,
  parseYear,
  normalizeText,
} from '../lib/parse';
import { defaultAnalysisFilters } from '../lib/types';
import type { Analysis, AnalysisFilters, Listing } from '../lib/types';

type CaptureMessage = { type: 'capture_now' };
const ANALYSIS_FILTERS_STORAGE_KEY = 'dealgauge_analysis_filters_v1';

function isDetailPage(): boolean {
  return location.pathname.startsWith('/iad/') && location.pathname.includes('/d/');
}

function isWillhaben(): boolean {
  return location.hostname === 'www.willhaben.at';
}

function extractTitleFromDetail(): string | null {
  const h1 = document.querySelector('h1');
  if (h1?.textContent) return h1.textContent.trim();
  const candidates = extractTextCandidates(document, '[data-testid*="title"], [class*="title"]');
  return candidates[0] ?? null;
}

function extractPriceFromDetail(): number | null {
  const priceCandidates = extractTextCandidates(document, '[data-testid*="price"], [class*="price"]');
  for (const candidate of priceCandidates) {
    const price = parsePriceEur(candidate);
    if (price) return price;
  }
  const bodyText = document.body?.innerText ?? '';
  return parsePriceEur(bodyText);
}

function findBasisdatenRoot(): Element | null {
  const headings = Array.from(document.querySelectorAll('h2, h3, h4'));
  for (const heading of headings) {
    const text = normalizeText(heading.textContent);
    if (!text || !text.includes('basisdaten')) continue;
    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (sibling.querySelector('[data-testid="attribute-item"]')) return sibling;
      sibling = sibling.nextElementSibling;
    }
    const parent = heading.parentElement;
    if (parent && parent.querySelector('[data-testid="attribute-item"]')) return parent;
  }
  return null;
}

function extractBasisdatenValue(root: ParentNode, label: string): string | null {
  const items = Array.from(root.querySelectorAll('[data-testid="attribute-item"]'));
  for (const item of items) {
    const title = item.querySelector('[data-testid="attribute-title"]')?.textContent ?? '';
    const value = item.querySelector('[data-testid="attribute-value"]')?.textContent ?? '';
    if (!title || !value) continue;
    if (normalizeText(title).includes(label)) return value.trim();
  }
  return null;
}

function extractDetailSpecs(): {
  year: number | null;
  mileage_km: number | null;
  ps: number | null;
  erstzulassung: string | null;
  fuel: string | null;
  drivetrain: string | null;
  transmission: string | null;
} {
  const text = document.body?.innerText ?? '';
  const basisdatenRoot = findBasisdatenRoot();
  const erstzulassung = basisdatenRoot ? extractBasisdatenValue(basisdatenRoot, 'erstzulassung') : null;
  const fuel = basisdatenRoot ? extractBasisdatenValue(basisdatenRoot, 'treibstoff') : null;
  const drivetrain = basisdatenRoot ? extractBasisdatenValue(basisdatenRoot, 'antrieb') : null;
  const transmission = basisdatenRoot ? extractBasisdatenValue(basisdatenRoot, 'getriebeart') : null;
  const yearFromBasis = erstzulassung ? parseYear(erstzulassung) : null;
  return {
    year: yearFromBasis ?? parseYear(text),
    mileage_km: parseMileageKm(text),
    ps: parsePowerPs(text),
    erstzulassung,
    fuel,
    drivetrain,
    transmission,
  };
}

function buildDetailListing(): Listing | null {
  if (!isWillhaben() || !isDetailPage()) return null;
  const url = canonicalizeUrl(location.href);
  const capturedAt = nowIso();
  const title = extractTitleFromDetail();
  const price = extractPriceFromDetail();
  const { year, mileage_km, ps, erstzulassung, fuel, drivetrain, transmission } = extractDetailSpecs();
  const classified = classifyFromTitle(title);
  return {
    id: url,
    url,
    title,
    price_eur: price,
    price_history: price !== null ? [{ price_eur: price, captured_at: capturedAt }] : [],
    brand: classified.brand,
    model: classified.model,
    trim: classified.trim,
    year,
    mileage_km,
    ps,
    erstzulassung,
    fuel,
    drivetrain,
    transmission,
    captured_at: capturedAt,
    source: 'detail',
  };
}

function extractCardTitle(card: Element): string | null {
  const titleCandidate =
    (card.querySelector('h2, h3, [data-testid*="title"]') as HTMLElement | null)?.innerText ??
    (card.querySelector('a[href*="/iad/"]') as HTMLElement | null)?.innerText ??
    card.textContent;
  return titleCandidate ? titleCandidate.trim() : null;
}

function extractCardPrice(card: Element): number | null {
  const priceCandidate =
    (card.querySelector('[data-testid*="price"], [class*="price"]') as HTMLElement | null)?.innerText ??
    card.textContent;
  return parsePriceEur(priceCandidate ?? null);
}

function extractCardTeaserAttributes(card: Element): Array<{ value: string; label: string }> {
  const rows = Array.from(card.querySelectorAll('[data-testid^="search-result-entry-teaser-attributes-"]'));
  const attributes: Array<{ value: string; label: string }> = [];
  for (const row of rows) {
    const spans = Array.from(row.querySelectorAll('span')) as HTMLElement[];
    if (spans.length === 0) continue;
    const value = spans[0]?.innerText?.trim() ?? '';
    const label = spans[1]?.innerText?.trim() ?? '';
    if (!value) continue;
    attributes.push({ value, label });
  }
  return attributes;
}

function extractCardAttributeValue(card: Element, labelNeedles: string[]): string | null {
  const attrs = extractCardTeaserAttributes(card);
  const match = attrs.find((attr) => {
    const label = normalizeText(attr.label);
    return labelNeedles.some((needle) => label.includes(needle));
  });
  return match?.value?.trim() ?? null;
}

function extractCardYear(card: Element): number | null {
  const attrs = extractCardTeaserAttributes(card);
  const ezAttr = attrs.find((attr) => {
    const label = normalizeText(attr.label);
    return label.includes('ez') || label.includes('erstzulassung');
  });
  if (ezAttr) {
    const parsed = parseYear(`${ezAttr.value} ${ezAttr.label}`);
    if (parsed !== null) return parsed;
  }

  const text = card.textContent ?? '';
  const match = text.match(/Erstzulassung[^0-9]*(19[8-9]\d|20[0-2]\d|203[0-5])/i);
  if (match) return Number.parseInt(match[1], 10);
  return parseYear(text);
}

function extractCardMileage(card: Element): number | null {
  const attrs = extractCardTeaserAttributes(card);
  const kmAttr = attrs.find((attr) => normalizeText(attr.label).includes('km'));
  if (kmAttr) {
    const parsed = parseMileageKm(`${kmAttr.value} km`);
    if (parsed !== null) return parsed;
  }

  const text = card.textContent ?? '';
  return parseMileageKm(text);
}

function extractCardPs(card: Element): number | null {
  const attrs = extractCardTeaserAttributes(card);
  const psAttr = attrs.find((attr) => normalizeText(attr.label).includes('ps'));
  if (psAttr) {
    const parsed = parsePowerPs(`${psAttr.value} PS`);
    if (parsed !== null) return parsed;
  }

  const text = card.textContent ?? '';
  return parsePowerPs(text);
}

function extractCardFuel(card: Element): string | null {
  return extractCardAttributeValue(card, ['treibstoff', 'kraftstoff']);
}

function extractCardDrivetrain(card: Element): string | null {
  return extractCardAttributeValue(card, ['antrieb']);
}

function extractCardTransmission(card: Element): string | null {
  return extractCardAttributeValue(card, ['getriebe', 'getriebeart']);
}

function extractSearchListings(): Listing[] {
  if (!isWillhaben()) return [];
  const anchors = Array.from(document.querySelectorAll('a[href*="/iad/"]')) as HTMLAnchorElement[];
  const uniqueUrls = new Map<string, HTMLAnchorElement>();
  for (const anchor of anchors) {
    if (!anchor.href) continue;
    if (!anchor.href.includes('/iad/')) continue;
    const url = canonicalizeUrl(anchor.href);
    if (!uniqueUrls.has(url)) uniqueUrls.set(url, anchor);
  }

  const listings: Listing[] = [];
  for (const [url, anchor] of uniqueUrls.entries()) {
    const card = anchor.closest('article, li') ?? anchor.closest('div');
    const title = card ? extractCardTitle(card) : (anchor.innerText?.trim() ?? null);
    const price = card ? extractCardPrice(card) : parsePriceEur(anchor.innerText ?? null);
    const year = card ? extractCardYear(card) : null;
    const mileage_km = card ? extractCardMileage(card) : null;
    const ps = card ? extractCardPs(card) : null;
    const fuel = card ? extractCardFuel(card) : null;
    const drivetrain = card ? extractCardDrivetrain(card) : null;
    const transmission = card ? extractCardTransmission(card) : null;
    const capturedAt = nowIso();
    const classified = classifyFromTitle(title);
    listings.push({
      id: url,
      url,
      title,
      price_eur: price,
      price_history: price !== null ? [{ price_eur: price, captured_at: capturedAt }] : [],
      brand: classified.brand,
      model: classified.model,
      trim: classified.trim,
      year,
      mileage_km,
      ps,
      erstzulassung: null,
      fuel,
      drivetrain,
      transmission,
      captured_at: capturedAt,
      source: 'search',
    });
  }
  return listings;
}

async function capture(): Promise<void> {
  const payload: Listing[] = [];
  const detail = buildDetailListing();
  if (detail) payload.push(detail);
  if (!detail) {
    const searchListings = extractSearchListings();
    if (searchListings.length > 0) payload.push(...searchListings);
  }
  if (payload.length > 0) {
    await browser.runtime.sendMessage({ type: 'upsert_listings', listings: payload });
  }
}

function formatEur(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('de-AT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function sanitizeAnalysisFilters(filters: Partial<AnalysisFilters> | null | undefined): AnalysisFilters {
  const defaults = defaultAnalysisFilters();
  if (!filters) return defaults;
  return {
    matchFuel: filters.matchFuel === true,
    matchDrivetrain: filters.matchDrivetrain === true,
    matchTransmission: filters.matchTransmission === true,
  };
}

function serializeAnalysisFilters(filters: AnalysisFilters): string {
  return `${filters.matchFuel ? 1 : 0}${filters.matchDrivetrain ? 1 : 0}${filters.matchTransmission ? 1 : 0}`;
}

let currentAnalysisFilters: AnalysisFilters = defaultAnalysisFilters();

async function loadAnalysisFiltersFromStorage(): Promise<void> {
  const stored = await browser.storage.local.get(ANALYSIS_FILTERS_STORAGE_KEY);
  currentAnalysisFilters = sanitizeAnalysisFilters(
    stored?.[ANALYSIS_FILTERS_STORAGE_KEY] as Partial<AnalysisFilters> | undefined,
  );
}

async function saveAnalysisFilters(filters: AnalysisFilters): Promise<void> {
  currentAnalysisFilters = sanitizeAnalysisFilters(filters);
  await browser.storage.local.set({
    [ANALYSIS_FILTERS_STORAGE_KEY]: currentAnalysisFilters,
  });
}

let panelHost: HTMLElement | null = null;
const SEARCH_ANALYSIS_TTL_MS = 60_000;
type SearchAnalyses = Array<{ id: string; analysis: Analysis | null }>;
type SearchAnalysisCache = {
  key: string;
  timestamp: number;
  analyses: SearchAnalyses;
};
let searchAnalysisCache: SearchAnalysisCache | null = null;
let searchAnalysisInFlight: { key: string; promise: Promise<SearchAnalyses | null> } | null = null;
let searchAnalysisGeneration = 0;

function buildSearchAnalysisKey(pageUrl: string, listingIds: string[], filters: AnalysisFilters): string {
  const sortedIds = [...listingIds].sort();
  return `${pageUrl}|${serializeAnalysisFilters(filters)}|${sortedIds.join(',')}`;
}

function isSearchAnalysisCacheValid(cache: SearchAnalysisCache | null, key: string): cache is SearchAnalysisCache {
  if (!cache) return false;
  if (cache.key !== key) return false;
  return Date.now() - cache.timestamp <= SEARCH_ANALYSIS_TTL_MS;
}

async function getSearchAnalyses(key: string, listings: Listing[], filters: AnalysisFilters): Promise<SearchAnalyses | null> {
  if (isSearchAnalysisCacheValid(searchAnalysisCache, key)) {
    return searchAnalysisCache.analyses;
  }
  if (searchAnalysisInFlight && searchAnalysisInFlight.key === key) {
    return searchAnalysisInFlight.promise;
  }
  const generation = searchAnalysisGeneration;
  const request = browser.runtime
    .sendMessage({ type: 'analyze_listings', listings, filters })
    .then((response) => {
      if (searchAnalysisGeneration !== generation) return null;
      if (!response?.analyses) return null;
      searchAnalysisCache = { key, timestamp: Date.now(), analyses: response.analyses as SearchAnalyses };
      return response.analyses as SearchAnalyses;
    })
    .finally(() => {
      if (searchAnalysisInFlight?.key === key) {
        searchAnalysisInFlight = null;
      }
    });
  searchAnalysisInFlight = { key, promise: request };
  return request;
}

function resetSearchAnalysisCache(): void {
  searchAnalysisGeneration += 1;
  searchAnalysisCache = null;
  searchAnalysisInFlight = null;
}

function ensurePanelRoot(): ShadowRoot {
  const existing = document.getElementById('dealgauge-panel');
  if (existing && (existing as HTMLElement).shadowRoot) {
    panelHost = existing as HTMLElement;
    return (existing as HTMLElement).shadowRoot!;
  }
  const host = document.createElement('div');
  host.id = 'dealgauge-panel';
  host.style.all = 'initial';
  host.style.zIndex = '2147483647';
  host.style.position = 'fixed';
  host.style.right = '16px';
  host.style.bottom = '16px';
  document.documentElement.appendChild(host);
  panelHost = host;
  return host.attachShadow({ mode: 'open' });
}

function renderPanel(data: {
  url: string;
  title: string | null;
  price_eur: number | null;
  brand: string | null;
  model: string | null;
  trim: string | null;
  ps: number | null;
  erstzulassung: string | null;
  fuel: string | null;
  drivetrain: string | null;
  transmission: string | null;
  analysis: Analysis | null;
  last_captured: string | null;
  price_history: Array<{ price_eur: number; captured_at: string }>;
  confidence: string;
}): void {
  const notEnough = !data.analysis || data.analysis.not_enough_data;
  const comparables =
    data.analysis?.comparables?.filter((comp) => canonicalizeUrl(comp.url) !== canonicalizeUrl(data.url)) ?? [];
  const cheaperAlternatives = comparables.filter(
    (comp) => comp.price_eur !== null && data.price_eur !== null && comp.price_eur < data.price_eur,
  );
  const detailsCollapsed =
    (window.localStorage.getItem('dealgauge_panel_details_collapsed') ?? 'true') === 'true';
  const filtersCollapsed =
    (window.localStorage.getItem('dealgauge_panel_filters_collapsed') ?? 'true') === 'true';
  const root = ensurePanelRoot();
  root.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;600&display=swap');
      :host { all: initial; }
      .panel {
        font-family: "Manrope", "Segoe UI", system-ui, sans-serif;
        background: radial-gradient(circle at top left, #f6f1e9 0%, #f3efe7 45%, #efe9df 100%);
        color: #1d1b16;
        border: 1px solid rgba(29, 27, 22, 0.15);
        box-shadow: 0 12px 24px rgba(29, 27, 22, 0.18);
        border-radius: 14px;
        width: 340px;
        padding: 14px;
      }
      .header { display: flex; justify-content: space-between; align-items: start; gap: 8px; cursor: grab; }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand img { width: 60px; height: 60px; border-radius: 14px; display: block; }
      .title { font-size: 17px; font-weight: 600; margin: 0; }
      .subtitle { font-size: 13px; color: #6a5f53; margin: 4px 0 0; }
      .close {
        all: unset;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 6px;
      }
      .close:hover { background: rgba(0,0,0,0.06); }
      .price-row { display: flex; align-items: center; justify-content: space-between; margin: 8px 0; }
      .price-row.clickable { cursor: pointer; }
      .price { font-size: 18px; font-weight: 600; }
      .toggle {
        all: unset;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 6px;
      }
      .toggle:hover { background: rgba(0,0,0,0.06); }
      .row { display: flex; justify-content: space-between; font-size: 11.5px; margin: 6px 0; }
      .label { color: #6a5f53; font-size: 11px; }
      .score { font-size: 15px; margin-top: 10px; display: flex; justify-content: space-between; }
      .pos { color: #1d6b3b; font-weight: 600; }
      .neg { color: #8b1d1d; font-weight: 600; }
      .note { font-size: 14px; color: #8b1d1d; margin-top: 8px; }
      .muted { color: #7b7164; font-size: 11.5px; }
      ul { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 8px; }
      li { display: flex; justify-content: space-between; font-size: 12px; align-items: flex-start; }
      li a { color: #1d1b16; text-decoration: underline; text-decoration-thickness: 1px; }
      .comp-price { font-size: 14.5px; font-weight: 600; }
      .comp-meta { text-align: right; line-height: 1.35; }
      .last-viewed { display: block; color: #8a8176; font-size: 11.5px; margin-top: 2px; }
      .card {
        background: rgba(255, 255, 255, 0.7);
        border: 1px solid rgba(29, 27, 22, 0.08);
        border-radius: 12px;
        padding: 10px 12px;
        box-shadow: 0 6px 16px rgba(29, 27, 22, 0.08);
      }
      .section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #7b7164;
        margin-bottom: 6px;
      }
      .card.comps li,
      .card.alternatives li { font-size: 13.5px; }
      .card.comps .section-title,
      .card.alternatives .section-title { font-size: 12px; }
      .card.comps .muted,
      .card.alternatives .muted { font-size: 12.5px; }
      .card.details.collapsed .details-body { display: none; }
      .card.details.collapsed .price-row { margin: 4px 0; }
      .card.filters.collapsed .filters-body { display: none; }
      .card.filters .filters-header { display: flex; justify-content: space-between; align-items: center; }
      .filters { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .filter-item { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: #1d1b16; }
      .filter-item input { accent-color: #6a5f53; margin: 0; }
      .divider { border-top: 1px solid rgba(29, 27, 22, 0.08); margin: 10px 0; }
    </style>
    <div class="panel" role="dialog" aria-label="DealGauge">
      <div class="header" data-drag-handle="true">
        <div class="brand">
          <img src="${browser.runtime.getURL('/icon/128.png')}" alt="DealGauge" />
          <div>
            <div class="title">DealGauge</div>
          <div class="subtitle">${data.title ?? 'Anzeige'}</div>
          </div>
        </div>
        <button class="close" aria-label="Schließen">×</button>
      </div>
      <div class="card details${detailsCollapsed ? ' collapsed' : ''}">
        <div class="price-row clickable" data-toggle-details-row="true">
          <div class="price">${formatEur(data.price_eur)}</div>
          <button class="toggle" data-toggle-details="true" aria-label="Details ein-/ausblenden">${
            detailsCollapsed ? '▸' : '▾'
          }</button>
        </div>
        <div class="details-body">
        <div class="row"><span class="label">Marke</span><span>${data.brand ?? '—'}</span></div>
        <div class="row"><span class="label">Modell</span><span>${data.model ?? '—'}</span></div>
        <div class="row"><span class="label">Ausstattung</span><span>${data.trim ?? '—'}</span></div>
          <div class="row"><span class="label">PS</span><span>${data.ps ? data.ps + ' PS' : '—'}</span></div>
          <div class="row"><span class="label">Erstzulassung</span><span>${data.erstzulassung ?? '—'}</span></div>
          <div class="row"><span class="label">Treibstoff</span><span>${data.fuel ?? '—'}</span></div>
          <div class="row"><span class="label">Antrieb</span><span>${data.drivetrain ?? '—'}</span></div>
          <div class="row"><span class="label">Getriebeart</span><span>${data.transmission ?? '—'}</span></div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="card">
        <div class="section-title">Datenanalyse</div>
        <div class="row"><span class="label">Vergleichbare Anzeigen</span><span>${data.analysis?.comparables_count ?? 0}</span></div>
        <div class="row"><span class="label">Datenbasis</span><span>${data.confidence} (${data.analysis?.comparables_count ?? 0})</span></div>
        <div class="row"><span class="label">Zuletzt erfasst</span><span class="muted">${data.last_captured ?? '—'}</span></div>
        ${
          notEnough
            ? `<div class="note">Nicht genug Daten (mind. 10 vergleichbare Anzeigen nötig).</div>`
            : `
              <div class="row"><span class="label">Erwartet</span><span>${formatEur(
                data.analysis?.expected_price ?? null,
              )}</span></div>
              <div class="row"><span class="label">Abweichung</span><span>${formatEur(
                data.analysis?.diff_eur ?? null,
              )} (${formatPercent(data.analysis?.diff_pct ?? null)})</span></div>
              <div class="score"><span>Angebots-Score</span><span class="${
                (data.analysis?.deal_score ?? 0) >= 0 ? 'pos' : 'neg'
              }">${formatPercent(data.analysis?.deal_score ?? null)}</span></div>
            `
        }
      </div>
      ${
        comparables.length
          ? `
            <div class="divider"></div>
            <div class="card comps">
              <div class="section-title">Vergleichbare Anzeigen</div>
              <ul>
                ${comparables
                  .map(
                    (comp) =>
                      `<li><span class="comp-price"><a href="${comp.url}" target="_blank" rel="noreferrer">${formatEur(
                        comp.price_eur,
                      )}</a></span><span class="comp-meta">${comp.year ?? '—'} · ${
                        comp.mileage_km ? comp.mileage_km.toLocaleString('de-AT') + ' km' : '—'
                      } · ${comp.ps ? comp.ps + ' PS' : '—'}<span class="last-viewed">${
                        comp.captured_at
                          ? `Zuletzt gesehen ${new Date(comp.captured_at).toLocaleString('de-AT', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}`
                          : 'Zuletzt gesehen —'
                      }</span></span></li>`,
                  )
                  .join('')}
              </ul>
            </div>
          `
          : ''
      }
      ${
        cheaperAlternatives.length
          ? `
            <div class="divider"></div>
            <div class="card alternatives">
              <div class="section-title">Günstigere Alternativen</div>
              <ul>
                ${cheaperAlternatives
                  .slice(0, 5)
                  .map(
                    (comp) =>
                      `<li><span class="comp-price"><a href="${comp.url}" target="_blank" rel="noreferrer">${formatEur(
                        comp.price_eur,
                      )}</a></span><span class="comp-meta">${comp.year ?? '—'} · ${
                        comp.mileage_km ? comp.mileage_km.toLocaleString('de-AT') + ' km' : '—'
                      } · ${comp.ps ? comp.ps + ' PS' : '—'}<span class="last-viewed">${
                        comp.captured_at
                          ? `Zuletzt gesehen ${new Date(comp.captured_at).toLocaleString('de-AT', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}`
                          : 'Zuletzt gesehen —'
                      }</span></span></li>`,
                  )
                  .join('')}
              </ul>
            </div>
          `
          : ''
      }
      ${
        data.price_history.length
          ? `
            <div class="divider"></div>
            <div class="card">
              <div class="section-title">Preishistorie</div>
              <ul>
                ${data.price_history
                  .slice(-2)
                  .reverse()
                  .map(
                    (entry) =>
                      `<li><span>${formatEur(entry.price_eur)}</span><span class="muted">${new Date(
                        entry.captured_at,
                      ).toLocaleString('de-AT', { dateStyle: 'medium' })}</span></li>`,
                  )
                  .join('')}
              </ul>
            </div>
          `
          : ''
      }
      <div class="divider"></div>
      <div class="card filters${filtersCollapsed ? ' collapsed' : ''}">
        <div class="filters-header" data-toggle-filters-row="true">
          <div class="section-title">Filter Vergleichsmenge</div>
          <button class="toggle" data-toggle-filters="true" aria-label="Filter ein-/ausblenden">${
            filtersCollapsed ? '▸' : '▾'
          }</button>
        </div>
        <div class="filters-body">
          <div class="filters">
            <label class="filter-item">
              <input type="checkbox" data-filter-key="matchFuel" ${currentAnalysisFilters.matchFuel ? 'checked' : ''} />
              <span>Nur gleicher Treibstoff</span>
            </label>
            <label class="filter-item">
              <input type="checkbox" data-filter-key="matchDrivetrain" ${currentAnalysisFilters.matchDrivetrain ? 'checked' : ''} />
              <span>Nur gleicher Antrieb</span>
            </label>
            <label class="filter-item">
              <input type="checkbox" data-filter-key="matchTransmission" ${currentAnalysisFilters.matchTransmission ? 'checked' : ''} />
              <span>Nur gleiche Getriebeart</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  `;
  const closeButton = root.querySelector('.close') as HTMLButtonElement | null;
  closeButton?.addEventListener('click', () => {
    root.host.remove();
  });

  const toggleButton = root.querySelector('[data-toggle-details="true"]') as HTMLButtonElement | null;
  const detailsRow = root.querySelector('[data-toggle-details-row="true"]') as HTMLElement | null;
  const toggleDetails = () => {
    const card = root.querySelector('.card.details') as HTMLElement | null;
    if (!card || !toggleButton) return;
    const nextCollapsed = !card.classList.contains('collapsed');
    card.classList.toggle('collapsed', nextCollapsed);
    toggleButton.textContent = nextCollapsed ? '▸' : '▾';
    window.localStorage.setItem('dealgauge_panel_details_collapsed', String(nextCollapsed));
  };
  if (toggleButton) {
    toggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleDetails();
    });
  }
  detailsRow?.addEventListener('click', () => {
    toggleDetails();
  });

  const filtersToggleButton = root.querySelector('[data-toggle-filters="true"]') as HTMLButtonElement | null;
  const filtersRow = root.querySelector('[data-toggle-filters-row="true"]') as HTMLElement | null;
  const toggleFilters = () => {
    const card = root.querySelector('.card.filters') as HTMLElement | null;
    if (!card || !filtersToggleButton) return;
    const nextCollapsed = !card.classList.contains('collapsed');
    card.classList.toggle('collapsed', nextCollapsed);
    filtersToggleButton.textContent = nextCollapsed ? '▸' : '▾';
    window.localStorage.setItem('dealgauge_panel_filters_collapsed', String(nextCollapsed));
  };
  if (filtersToggleButton) {
    filtersToggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleFilters();
    });
  }
  filtersRow?.addEventListener('click', () => {
    toggleFilters();
  });

  const handle = root.querySelector('[data-drag-handle="true"]') as HTMLElement | null;
  if (handle) {
    handle.addEventListener('pointerdown', (event) => {
      if (!panelHost) return;
      const host = panelHost;
      const rect = host.getBoundingClientRect();
      host.style.right = '';
      host.style.bottom = '';
      host.style.left = `${rect.left}px`;
      host.style.top = `${rect.top}px`;
      const startX = event.clientX;
      const startY = event.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;
      const onMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const newLeft = Math.min(
          Math.max(8, startLeft + dx),
          window.innerWidth - rect.width - 8,
        );
        const newTop = Math.min(
          Math.max(8, startTop + dy),
          window.innerHeight - rect.height - 8,
        );
        host.style.left = `${newLeft}px`;
        host.style.top = `${newTop}px`;
      };
      const onUp = async () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const left = parseFloat(host.style.left || '0');
        const top = parseFloat(host.style.top || '0');
        await browser.storage.local.set({
          dealgauge_panel_position_v1: { left, top },
        });
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  const filterCheckboxes = Array.from(
    root.querySelectorAll('input[data-filter-key]'),
  ) as HTMLInputElement[];
  for (const checkbox of filterCheckboxes) {
    checkbox.addEventListener('change', async () => {
      const key = checkbox.getAttribute('data-filter-key') as keyof AnalysisFilters | null;
      if (!key) return;
      const nextFilters: AnalysisFilters = {
        ...currentAnalysisFilters,
        [key]: checkbox.checked,
      };
      await saveAnalysisFilters(nextFilters);
      resetSearchAnalysisCache();
      await renderPanelForDetail();
      await renderDetailPriceBadge();
      await renderBadgesForSearch();
    });
  }
}

function ensureBadgeStyles(): void {
  if (document.getElementById('dealgauge-badge-style')) return;
  const style = document.createElement('style');
  style.id = 'dealgauge-badge-style';
  style.textContent = `
    .dealgauge-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
      border: 1px solid transparent;
      font-family: "Manrope", "Segoe UI", system-ui, sans-serif;
    }
    .dealgauge-badge.good { background: #e7f6ee; color: #1d6b3b; border-color: rgba(29, 107, 59, 0.2); }
    .dealgauge-badge.great { background: #dff2ea; color: #0f5b2d; border-color: rgba(15, 91, 45, 0.2); }
    .dealgauge-badge.fair { background: #f4efe8; color: #6a5f53; border-color: rgba(106, 95, 83, 0.2); }
    .dealgauge-badge.overpriced { background: #f9e3e3; color: #8b1d1d; border-color: rgba(139, 29, 29, 0.2); }
    .dealgauge-badge.na { background: #efefef; color: #6a6a6a; border-color: rgba(0, 0, 0, 0.08); }
    .dealgauge-badge[data-tooltip] { position: relative; }
    .dealgauge-badge[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(100% + 8px);
      background: #1d1b16;
      color: #fff;
      padding: 6px 8px;
      font-size: 11px;
      border-radius: 8px;
      white-space: pre;
      z-index: 2147483647;
    }
    .dealgauge-badge[data-tooltip]:hover::before {
      content: "";
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(100% + 2px);
      border: 6px solid transparent;
      border-top-color: #1d1b16;
    }
  `;
  document.head.appendChild(style);
}

function findPriceElement(card: Element): HTMLElement | null {
  const selectors = ['[data-testid*="price"]', '[class*="price"]'];
  for (const selector of selectors) {
    const el = card.querySelector(selector) as HTMLElement | null;
    if (el?.innerText?.includes('€')) return el;
  }
  const candidates = Array.from(card.querySelectorAll('span, div, p')) as HTMLElement[];
  return candidates.find((el) => /€/.test(el.innerText ?? '')) ?? null;
}

function findDetailPriceElement(): HTMLElement | null {
  const selectors = ['[data-testid*="price"]', '[class*="price"]'];
  for (const selector of selectors) {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (el?.innerText?.includes('€')) return el;
  }
  const labelCandidates = Array.from(document.querySelectorAll('span, div, p')) as HTMLElement[];
  const labelEl = labelCandidates.find((el) => /verkaufspreis/i.test(el.innerText ?? ''));
  if (labelEl) {
    const container = labelEl.closest('section, div, li') ?? labelEl.parentElement;
    if (container) {
      const valueEl = (Array.from(container.querySelectorAll('span, div, p')) as HTMLElement[])
        .reverse()
        .find((el) => /€/.test(el.innerText ?? ''));
      if (valueEl) return valueEl;
    }
  }
  return labelCandidates.find((el) => /€/.test(el.innerText ?? '')) ?? null;
}

function getBadgeLabel(dealScore: number | null, notEnough: boolean): { label: string; className: string } {
  if (notEnough || dealScore === null) return { label: 'k.A.', className: 'na' };
  if (dealScore >= 0.1) return { label: 'Top', className: 'great' };
  if (dealScore >= 0.03) return { label: 'Gut', className: 'good' };
  if (dealScore >= -0.03) return { label: 'Okay', className: 'fair' };
  return { label: 'Zu teuer', className: 'overpriced' };
}

async function renderBadgesForSearch(): Promise<void> {
  if (!isWillhaben() || isDetailPage()) return;
  ensureBadgeStyles();
  const searchListings = extractSearchListings();
  if (searchListings.length === 0) return;
  const key = buildSearchAnalysisKey(
    location.href,
    searchListings.map((listing) => listing.id),
    currentAnalysisFilters,
  );
  const analyses = await getSearchAnalyses(key, searchListings, currentAnalysisFilters);
  if (!analyses) return;

  const analysisMap = new Map<
    string,
    {
      deal_score: number | null;
      not_enough_data: boolean;
      expected_price: number | null;
      diff_pct: number | null;
      comparables_count: number;
    }
  >();
  for (const entry of analyses) {
    analysisMap.set(entry.id, {
      deal_score: entry.analysis?.deal_score ?? null,
      not_enough_data: entry.analysis?.not_enough_data ?? true,
      expected_price: entry.analysis?.expected_price ?? null,
      diff_pct: entry.analysis?.diff_pct ?? null,
      comparables_count: entry.analysis?.comparables_count ?? 0,
    });
  }

  const anchors = Array.from(document.querySelectorAll('a[href*="/iad/"]')) as HTMLAnchorElement[];
  for (const anchor of anchors) {
    if (!anchor.href?.includes('/iad/')) continue;
    const url = canonicalizeUrl(anchor.href);
    const card = anchor.closest('article, li, div');
    if (!card) continue;
    if (card.querySelector('[data-dealgauge-badge="true"]')) continue;
    const priceEl = findPriceElement(card);
    if (!priceEl) continue;
    const analysis = analysisMap.get(url);
    const badge = document.createElement('span');
    badge.setAttribute('data-dealgauge-badge', 'true');
    const { label, className } = getBadgeLabel(analysis?.deal_score ?? null, analysis?.not_enough_data ?? true);
    badge.className = `dealgauge-badge ${className}`;
    badge.textContent = label;
    if (analysis) {
      const expected = formatEur(analysis.expected_price ?? null);
      const diff = formatPercent(analysis.diff_pct ?? null);
      badge.setAttribute(
        'data-tooltip',
        `Erwartet: ${expected}\nAbw.: ${diff}\nVergl.: ${analysis.comparables_count}`,
      );
    }
    priceEl.appendChild(badge);
  }
}

let badgeScheduled = false;
let badgeObserver: MutationObserver | null = null;
let detailBadgeObserver: MutationObserver | null = null;
let lastUrl = location.href;

function scheduleBadgeRender(): void {
  if (badgeScheduled) return;
  badgeScheduled = true;
  window.setTimeout(() => {
    badgeScheduled = false;
    renderBadgesForSearch();
  }, 200);
}

function observeListingChanges(): void {
  if (badgeObserver || isDetailPage()) return;
  badgeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        scheduleBadgeRender();
        return;
      }
    }
  });
  badgeObserver.observe(document.body, { childList: true, subtree: true });
}

function observeDetailBadgeChanges(): void {
  if (detailBadgeObserver || !isDetailPage()) return;
  detailBadgeObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        renderDetailPriceBadge();
        return;
      }
    }
  });
  detailBadgeObserver.observe(document.body, { childList: true, subtree: true });
}

async function handleRouteChange(): Promise<void> {
  const current = location.href;
  if (current === lastUrl) return;
  lastUrl = current;
  resetSearchAnalysisCache();
  if (!isDetailPage()) {
    const existing = document.getElementById('dealgauge-panel');
    existing?.remove();
  }
  await capture();
  await renderPanelForDetail();
  await renderDetailPriceBadge();
  await renderBadgesForSearch();
  observeListingChanges();
  observeDetailBadgeChanges();
}

function observeRouteChanges(): void {
  window.setInterval(() => {
    handleRouteChange();
  }, 600);
  window.addEventListener('popstate', () => {
    handleRouteChange();
  });
  window.addEventListener('hashchange', () => {
    handleRouteChange();
  });
}

async function renderDetailPriceBadge(): Promise<void> {
  if (!isDetailPage() || !isWillhaben()) return;
  ensureBadgeStyles();
  const id = canonicalizeUrl(location.href);
  const response = await browser.runtime.sendMessage({ type: 'get_analysis', id, filters: currentAnalysisFilters });
  if (!response?.analysis) return;
  document.querySelectorAll('[data-dealgauge-detail-badge="true"]').forEach((el) => el.remove());
  const priceEl = findDetailPriceElement();
  const labelEl =
    (document.querySelector('[data-testid*="contact-box-price-box-price-label"]') as HTMLElement | null) ??
    (Array.from(document.querySelectorAll('span, div, p')).find((el) =>
      /verkaufspreis/i.test(el.textContent ?? ''),
    ) as HTMLElement | undefined);
  if (!priceEl && !labelEl) return;
  const analysis = response.analysis;
  const badge = document.createElement('span');
  badge.setAttribute('data-dealgauge-detail-badge', 'true');
  const { label, className } = getBadgeLabel(analysis?.deal_score ?? null, analysis?.not_enough_data ?? true);
  badge.className = `dealgauge-badge ${className}`;
  badge.style.marginLeft = '10px';
  badge.style.whiteSpace = 'nowrap';
  badge.textContent = label;
  const expected = formatEur(analysis.expected_price ?? null);
  const diff = formatPercent(analysis.diff_pct ?? null);
  badge.setAttribute('data-tooltip', `Erwartet: ${expected}\nAbw.: ${diff}\nVergl.: ${analysis.comparables_count}`);
  if (labelEl) {
    const container = (
      labelEl.closest('[data-testid="contact-box-price-box"]') ??
      labelEl.parentElement ??
      labelEl
    ) as HTMLElement;
    container.style.display = 'inline-flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.appendChild(badge);
  } else if (priceEl) {
    priceEl.appendChild(badge);
  }
  window.setTimeout(() => {
    if (!document.querySelector('[data-dealgauge-detail-badge="true"]')) {
      renderDetailPriceBadge();
    }
  }, 800);
}

async function renderPanelForDetail(): Promise<void> {
  if (!isDetailPage() || !isWillhaben()) return;
  const id = canonicalizeUrl(location.href);
  const response = await browser.runtime.sendMessage({ type: 'get_analysis', id, filters: currentAnalysisFilters });
  const countResponse = await browser.runtime.sendMessage({ type: 'get_count' });
  if (!response?.listing) return;
  const comps = response.analysis?.comparables_count ?? 0;
  const hasYear = !!response.listing.year;
  const hasMileage = !!response.listing.mileage_km;
  const confidence =
    comps >= 25 && hasYear && hasMileage ? 'Hoch' : comps >= 10 && (hasYear || hasMileage) ? 'Mittel' : 'Niedrig';
  renderPanel({
    url: response.listing.url,
    title: response.listing.title,
    price_eur: response.listing.price_eur,
    brand: response.listing.brand,
    model: response.listing.model,
    trim: response.listing.trim,
    ps: response.listing.ps ?? null,
    erstzulassung: response.listing.erstzulassung ?? null,
    fuel: response.listing.fuel ?? null,
    drivetrain: response.listing.drivetrain ?? null,
    transmission: response.listing.transmission ?? null,
    analysis: response.analysis ?? null,
    price_history: response.listing.price_history ?? [],
    confidence,
    last_captured: countResponse?.last_captured
      ? new Date(countResponse.last_captured).toLocaleString('de-AT', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—',
  });
  if (panelHost) {
    const stored = await browser.storage.local.get('dealgauge_panel_position_v1');
    const pos = stored?.dealgauge_panel_position_v1 as { left: number; top: number } | undefined;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      panelHost.style.right = '';
      panelHost.style.bottom = '';
      panelHost.style.left = `${pos.left}px`;
      panelHost.style.top = `${pos.top}px`;
    }
  }
}

export default defineContentScript({
  matches: ['https://www.willhaben.at/*'],
  main() {
    loadAnalysisFiltersFromStorage().then(() => {
      capture().then(() => {
        renderPanelForDetail();
        renderDetailPriceBadge();
        renderBadgesForSearch();
        observeListingChanges();
        observeDetailBadgeChanges();
        observeRouteChanges();
      });
    });
    browser.runtime.onMessage.addListener((message: CaptureMessage) => {
      if (message?.type === 'capture_now') {
        return capture().then(() => {
          renderPanelForDetail();
          renderDetailPriceBadge();
          renderBadgesForSearch();
          observeListingChanges();
          return { ok: true };
        });
      }
      return undefined;
    });
  },
});
