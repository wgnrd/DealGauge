<script lang="ts">
  import { onMount } from 'svelte';
  import type { Analysis, Listing } from '../../lib/types';
  import { canonicalizeUrl } from '../../lib/parse';

  let totalCount = 0;
  let activeListing: Listing | null = null;
  let analysis: Analysis | null = null;
  let statusMessage: string | null = null;
  let isDetailPage = false;
  let datasetLastCaptured: string | null = null;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  function formatText(value: string | null | undefined): string {
    return value ? value : '—';
  }

  function confidenceLabel(): string {
    if (!analysis || !activeListing) return '—';
    const comps = analysis.comparables_count;
    const hasYear = !!activeListing.year;
    const hasMileage = !!activeListing.mileage_km;
    if (comps >= 25 && hasYear && hasMileage) return 'High';
    if (comps >= 10 && (hasYear || hasMileage)) return 'Medium';
    return 'Low';
  }

  function formatDate(value: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('de-AT', { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function downloadData(kind: 'json' | 'csv') {
    const response = await browser.runtime.sendMessage({ type: 'get_export' });
    if (!response?.listings) return;
    if (kind === 'json') {
      const blob = new Blob([JSON.stringify(response.listings, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dealgauge-listings.json';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const rows = response.listings as Listing[];
    const header = [
      'id',
      'url',
      'title',
      'price_eur',
      'brand',
      'model',
      'trim',
      'year',
      'mileage_km',
      'ps',
      'captured_at',
    ];
    const csv = [
      header.join(','),
      ...rows.map((row) =>
        header
          .map((key) => {
            const value = (row as Record<string, unknown>)[key];
            if (value === null || value === undefined) return '';
            return `"${String(value).replace(/"/g, '""')}"`;
          })
          .join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dealgauge-listings.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadData() {
    const countResponse = await browser.runtime.sendMessage({ type: 'get_count' });
    totalCount = countResponse?.count ?? 0;
    datasetLastCaptured = countResponse?.last_captured ?? null;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      statusMessage = 'Open a willhaben.at listing to see deal insights.';
      return;
    }
    isDetailPage = tab.url.includes('willhaben.at') && new URL(tab.url).pathname.startsWith('/iad/');
    if (!isDetailPage) {
      statusMessage = 'Open a willhaben.at listing detail page to see deal insights.';
      return;
    }
    const id = canonicalizeUrl(tab.url);
    let response = await browser.runtime.sendMessage({ type: 'get_analysis', id });
    if (!response?.listing && tab.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'capture_now' });
      await wait(300);
      response = await browser.runtime.sendMessage({ type: 'get_analysis', id });
    }
    activeListing = response?.listing ?? null;
    analysis = response?.analysis ?? null;
    if (!activeListing) {
      statusMessage = 'Listing not captured yet. Refresh the page and try again.';
    }
  }

  onMount(() => {
    loadData();
  });
</script>

<main>
  <header>
    <div class="title-block">
      <div class="brand">
        <img src="/icon/128.png" alt="DealGauge" />
        <h1>DealGauge</h1>
      </div>
      <p>Willhaben car deal check</p>
    </div>
    <div class="metric">
      <span class="metric-label">Stored listings</span>
      <span class="metric-value">{totalCount}</span>
    </div>
  </header>
  <section class="freshness">
    <span class="label">Last captured</span>
    <span class="value">{formatDate(datasetLastCaptured)}</span>
  </section>

  {#if statusMessage}
    <section class="status">{statusMessage}</section>
  {:else if activeListing}
    <section class="listing">
      <h2>{activeListing.title}</h2>
      <div class="price">{formatEur(activeListing.price_eur)}</div>
      <div class="grid">
        <div>
          <span class="label">Brand</span>
          <span class="value">{formatText(activeListing.brand)}</span>
        </div>
        <div>
          <span class="label">Model</span>
          <span class="value">{formatText(activeListing.model)}</span>
        </div>
        <div>
          <span class="label">Trim</span>
          <span class="value">{formatText(activeListing.trim)}</span>
        </div>
        <div>
          <span class="label">Year</span>
          <span class="value">{activeListing.year ?? '—'}</span>
        </div>
        <div>
          <span class="label">Mileage</span>
          <span class="value">
            {activeListing.mileage_km ? `${activeListing.mileage_km.toLocaleString('de-AT')} km` : '—'}
          </span>
        </div>
        <div>
          <span class="label">PS</span>
          <span class="value">{activeListing.ps ? `${activeListing.ps} PS` : '—'}</span>
        </div>
      </div>
    </section>

    <section class="analysis">
      <div class="metric-row">
        <span class="label">Comparables</span>
        <span class="value">{analysis?.comparables_count ?? 0}</span>
      </div>
      <div class="metric-row">
        <span class="label">Confidence</span>
        <span class="value">{confidenceLabel()}</span>
      </div>
      {#if analysis?.not_enough_data}
        <div class="insufficient">Not enough data (need 10+ comparable cars).</div>
      {:else}
        <div class="metric-row">
          <span class="label">Expected price</span>
          <span class="value">{formatEur(analysis?.expected_price ?? null)}</span>
        </div>
        <div class="metric-row">
          <span class="label">Difference</span>
          <span class="value">
            {formatEur(analysis?.diff_eur ?? null)} ({formatPercent(analysis?.diff_pct ?? null)})
          </span>
        </div>
        <div class="score">
          <span>Deal score</span>
          <strong class:positive={(analysis?.deal_score ?? 0) > 0} class:negative={(analysis?.deal_score ?? 0) < 0}>
            {formatPercent(analysis?.deal_score ?? null)}
          </strong>
        </div>
      {/if}
    </section>

    <section class="comps">
      <div class="metric-row">
        <span class="label">Closest comparables</span>
      </div>
      {#if analysis?.comparables?.length}
        <ul>
          {#each analysis.comparables as comp}
            <li>
              <span>
                <a href={comp.url} target="_blank" rel="noreferrer">
                  {formatEur(comp.price_eur)}
                </a>
              </span>
              <span class="muted">
                {comp.year ?? '—'} · {comp.mileage_km ? `${comp.mileage_km.toLocaleString('de-AT')} km` : '—'} · {comp.ps ? `${comp.ps} PS` : '—'}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="muted">No comparables yet.</div>
      {/if}
    </section>

    <section class="history">
      <div class="metric-row">
        <span class="label">Price history</span>
      </div>
      {#if activeListing.price_history?.length}
        <ul>
          {#each activeListing.price_history.slice(-3).reverse() as entry}
            <li>
              <span>{formatEur(entry.price_eur)}</span>
              <span class="muted">{formatDate(entry.captured_at)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="muted">No price changes yet.</div>
      {/if}
    </section>
  {/if}

  <section class="export">
    <button class="ghost" on:click={() => downloadData('json')}>Export JSON</button>
    <button class="ghost" on:click={() => downloadData('csv')}>Export CSV</button>
  </section>
</main>
