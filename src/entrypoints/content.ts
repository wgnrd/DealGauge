import { classifyFromTitle } from '../lib/classify';
import { canonicalizeUrl, extractTextCandidates, nowIso, parseMileageKm, parsePriceEur, parseYear } from '../lib/parse';
import type { Analysis, Listing } from '../lib/types';

type CaptureMessage = { type: 'capture_now' };

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

function extractYearAndMileageFromDetail(): { year: number | null; mileage_km: number | null } {
  const text = document.body?.innerText ?? '';
  return {
    year: parseYear(text),
    mileage_km: parseMileageKm(text),
  };
}

function buildDetailListing(): Listing | null {
  if (!isWillhaben() || !isDetailPage()) return null;
  const url = canonicalizeUrl(location.href);
  const capturedAt = nowIso();
  const title = extractTitleFromDetail();
  const price = extractPriceFromDetail();
  const { year, mileage_km } = extractYearAndMileageFromDetail();
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

function extractCardYear(card: Element): number | null {
  const text = card.textContent ?? '';
  const match = text.match(/Erstzulassung[^0-9]*(19[8-9]\d|20[0-2]\d|203[0-5])/i);
  if (match) return Number.parseInt(match[1], 10);
  return parseYear(text);
}

function extractCardMileage(card: Element): number | null {
  const text = card.textContent ?? '';
  return parseMileageKm(text);
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
    const card = anchor.closest('article, li, div');
    const title = card ? extractCardTitle(card) : (anchor.innerText?.trim() ?? null);
    const price = card ? extractCardPrice(card) : parsePriceEur(anchor.innerText ?? null);
    const year = card ? extractCardYear(card) : null;
    const mileage_km = card ? extractCardMileage(card) : null;
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

function buildSearchAnalysisKey(pageUrl: string, listingIds: string[]): string {
  const sortedIds = [...listingIds].sort();
  return `${pageUrl}|${sortedIds.join(',')}`;
}

function isSearchAnalysisCacheValid(cache: SearchAnalysisCache | null, key: string): cache is SearchAnalysisCache {
  if (!cache) return false;
  if (cache.key !== key) return false;
  return Date.now() - cache.timestamp <= SEARCH_ANALYSIS_TTL_MS;
}

async function getSearchAnalyses(key: string, listings: Listing[]): Promise<SearchAnalyses | null> {
  if (isSearchAnalysisCacheValid(searchAnalysisCache, key)) {
    return searchAnalysisCache.analyses;
  }
  if (searchAnalysisInFlight && searchAnalysisInFlight.key === key) {
    return searchAnalysisInFlight.promise;
  }
  const generation = searchAnalysisGeneration;
  const request = browser.runtime
    .sendMessage({ type: 'analyze_listings', listings })
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
  title: string | null;
  price_eur: number | null;
  brand: string | null;
  model: string | null;
  trim: string | null;
  analysis:
    | {
        expected_price: number | null;
        diff_eur: number | null;
        diff_pct: number | null;
        deal_score: number | null;
        comparables_count: number;
        not_enough_data: boolean;
      }
    | null;
  last_captured: string | null;
  price_history: Array<{ price_eur: number; captured_at: string }>;
  confidence: string;
}): void {
  const notEnough = !data.analysis || data.analysis.not_enough_data;
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
      .brand img { width: 34px; height: 34px; border-radius: 8px; display: block; }
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
      .price { font-size: 22px; font-weight: 600; margin: 10px 0; }
      .row { display: flex; justify-content: space-between; font-size: 14px; margin: 6px 0; }
      .label { color: #6a5f53; }
      .score { font-size: 15px; margin-top: 10px; display: flex; justify-content: space-between; }
      .pos { color: #1d6b3b; font-weight: 600; }
      .neg { color: #8b1d1d; font-weight: 600; }
      .note { font-size: 14px; color: #8b1d1d; margin-top: 8px; }
      .muted { color: #7b7164; font-size: 12px; }
      ul { list-style: none; padding: 0; margin: 6px 0 0; display: flex; flex-direction: column; gap: 4px; }
      li { display: flex; justify-content: space-between; font-size: 12px; }
      li a { color: #1d1b16; text-decoration: underline; text-decoration-thickness: 1px; }
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
      .divider { border-top: 1px solid rgba(29, 27, 22, 0.08); margin: 10px 0; }
    </style>
    <div class="panel" role="dialog" aria-label="DealGauge">
      <div class="header" data-drag-handle="true">
        <div class="brand">
          <img src="${browser.runtime.getURL('icon/128.png')}" alt="DealGauge" />
          <div>
            <div class="title">DealGauge</div>
          <div class="subtitle">${data.title ?? 'Listing'}</div>
          </div>
        </div>
        <button class="close" aria-label="Close">×</button>
      </div>
      <div class="card">
        <div class="price">${formatEur(data.price_eur)}</div>
        <div class="row"><span class="label">Brand</span><span>${data.brand ?? '—'}</span></div>
        <div class="row"><span class="label">Model</span><span>${data.model ?? '—'}</span></div>
        <div class="row"><span class="label">Trim</span><span>${data.trim ?? '—'}</span></div>
      </div>
      <div class="divider"></div>
      <div class="card">
        <div class="section-title">Market</div>
        <div class="row"><span class="label">Comparables</span><span>${data.analysis?.comparables_count ?? 0}</span></div>
        <div class="row"><span class="label">Confidence</span><span>${data.confidence}</span></div>
        <div class="row"><span class="label">Last captured</span><span class="muted">${data.last_captured ?? '—'}</span></div>
        ${
          notEnough
            ? `<div class="note">Not enough data (need 10+).</div>`
            : `
              <div class="row"><span class="label">Expected</span><span>${formatEur(
                data.analysis?.expected_price ?? null,
              )}</span></div>
              <div class="row"><span class="label">Difference</span><span>${formatEur(
                data.analysis?.diff_eur ?? null,
              )} (${formatPercent(data.analysis?.diff_pct ?? null)})</span></div>
              <div class="score"><span>Deal score</span><span class="${
                (data.analysis?.deal_score ?? 0) >= 0 ? 'pos' : 'neg'
              }">${formatPercent(data.analysis?.deal_score ?? null)}</span></div>
            `
        }
      </div>
      ${
        data.analysis?.comparables?.length
          ? `
            <div class="divider"></div>
            <div class="card">
              <div class="section-title">Closest comps</div>
              <ul>
                ${data.analysis.comparables
                  .map(
                    (comp) =>
                      `<li><span><a href="${comp.url}" target="_blank" rel="noreferrer">${formatEur(
                        comp.price_eur,
                      )}</a></span><span class="muted">${comp.year ?? '—'} · ${
                        comp.mileage_km ? comp.mileage_km.toLocaleString('de-AT') + ' km' : '—'
                      }</span></li>`,
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
              <div class="section-title">Price history</div>
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
    </div>
  `;
  const closeButton = root.querySelector('.close') as HTMLButtonElement | null;
  closeButton?.addEventListener('click', () => {
    root.host.remove();
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
      const valueEl = Array.from(container.querySelectorAll('span, div, p'))
        .reverse()
        .find((el) => /€/.test(el.innerText ?? '')) as HTMLElement | undefined;
      if (valueEl) return valueEl;
    }
  }
  return labelCandidates.find((el) => /€/.test(el.innerText ?? '')) ?? null;
}

function getBadgeLabel(dealScore: number | null, notEnough: boolean): { label: string; className: string } {
  if (notEnough || dealScore === null) return { label: 'N/A', className: 'na' };
  if (dealScore >= 0.1) return { label: 'Great', className: 'great' };
  if (dealScore >= 0.03) return { label: 'Good', className: 'good' };
  if (dealScore >= -0.03) return { label: 'Fair', className: 'fair' };
  return { label: 'Overpriced', className: 'overpriced' };
}

async function renderBadgesForSearch(): Promise<void> {
  if (!isWillhaben() || isDetailPage()) return;
  ensureBadgeStyles();
  const searchListings = extractSearchListings();
  if (searchListings.length === 0) return;
  const key = buildSearchAnalysisKey(
    location.href,
    searchListings.map((listing) => listing.id),
  );
  const analyses = await getSearchAnalyses(key, searchListings);
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
        `Expected: ${expected}\nDiff: ${diff}\nComps: ${analysis.comparables_count}`,
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
  const response = await browser.runtime.sendMessage({ type: 'get_analysis', id });
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
  badge.setAttribute('data-tooltip', `Expected: ${expected}\nDiff: ${diff}\nComps: ${analysis.comparables_count}`);
  if (labelEl) {
    const container =
      labelEl.closest('[data-testid="contact-box-price-box"]') ??
      labelEl.parentElement ??
      labelEl;
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
  const response = await browser.runtime.sendMessage({ type: 'get_analysis', id });
  const countResponse = await browser.runtime.sendMessage({ type: 'get_count' });
  if (!response?.listing) return;
  const comps = response.analysis?.comparables_count ?? 0;
  const hasYear = !!response.listing.year;
  const hasMileage = !!response.listing.mileage_km;
  const confidence =
    comps >= 25 && hasYear && hasMileage ? 'High' : comps >= 10 && (hasYear || hasMileage) ? 'Medium' : 'Low';
  renderPanel({
    title: response.listing.title,
    price_eur: response.listing.price_eur,
    brand: response.listing.brand,
    model: response.listing.model,
    trim: response.listing.trim,
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
    capture().then(() => {
      renderPanelForDetail();
      renderDetailPriceBadge();
      renderBadgesForSearch();
      observeListingChanges();
      observeDetailBadgeChanges();
      observeRouteChanges();
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
