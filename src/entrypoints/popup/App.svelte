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
  let pruneDays = 30;
  let importInput: HTMLInputElement | null = null;
  let showImportModal = false;
  let pendingImportListings: Listing[] = [];
  let pendingImportName: string | null = null;

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
    if (comps >= 25 && hasYear && hasMileage) return `Hoch (${comps})`;
    if (comps >= 10 && (hasYear || hasMileage)) return `Mittel (${comps})`;
    return `Niedrig (${comps})`;
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
      'erstzulassung',
      'fuel',
      'drivetrain',
      'transmission',
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

  function normalizeImportPayload(payload: unknown): Listing[] {
    if (Array.isArray(payload)) return payload as Listing[];
    if (payload && typeof payload === 'object' && Array.isArray((payload as { listings?: unknown }).listings)) {
      return (payload as { listings: Listing[] }).listings;
    }
    return [];
  }

  async function openImportDialog() {
    importInput?.click();
  }

  async function handleImport(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const listings = normalizeImportPayload(parsed).filter((item) => item && typeof item.id === 'string');
      if (!listings.length) {
        window.alert('Keine gültigen Daten im Import gefunden.');
        return;
      }
      pendingImportListings = listings;
      pendingImportName = file.name;
      showImportModal = true;
    } catch (error) {
      console.error('Import failed', error);
      window.alert('Import fehlgeschlagen. Datei ist kein gültiges JSON.');
    } finally {
      if (input) input.value = '';
    }
  }

  function cancelImport() {
    showImportModal = false;
    pendingImportListings = [];
    pendingImportName = null;
  }

  async function confirmImport(mode: 'merge' | 'replace') {
    if (!pendingImportListings.length) {
      cancelImport();
      return;
    }
    const response = await browser.runtime.sendMessage({
      type: 'import_listings',
      listings: pendingImportListings,
      mode,
    });
    if (response?.ok) {
      const importedCount = response.imported ?? pendingImportListings.length;
      window.alert(
        mode === 'replace'
          ? `Import abgeschlossen: ${importedCount} Anzeigen ersetzt.`
          : `Import abgeschlossen: ${importedCount} Anzeigen zusammengeführt.`,
      );
      await loadData();
    } else {
      window.alert('Import fehlgeschlagen.');
    }
    cancelImport();
  }

  async function clearAllData() {
    if (!window.confirm('Alle gespeicherten Anzeigen löschen? Das kann nicht rückgängig gemacht werden.')) return;
    await browser.runtime.sendMessage({ type: 'clear_all' });
    await loadData();
  }

  async function deleteCurrentListing() {
    if (!activeListing) return;
    if (!window.confirm('Aktuelle Anzeige aus dem Speicher löschen?')) return;
    await browser.runtime.sendMessage({ type: 'delete_listing', id: activeListing.id });
    await loadData();
  }

  async function pruneOlderThan() {
    const days = Number(pruneDays);
    if (!Number.isFinite(days) || days <= 0) {
      statusMessage = 'Bitte eine gültige Anzahl an Tagen für die Bereinigung eingeben.';
      return;
    }
    if (!window.confirm(`Anzeigen löschen, die vor mehr als ${days} Tagen erfasst wurden?`)) return;
    await browser.runtime.sendMessage({ type: 'prune_older_than', days });
    await loadData();
  }

  async function loadData() {
    const countResponse = await browser.runtime.sendMessage({ type: 'get_count' });
    totalCount = countResponse?.count ?? 0;
    datasetLastCaptured = countResponse?.last_captured ?? null;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      statusMessage = 'Öffne eine willhaben.at-Anzeige, um die Analyse zu sehen.';
      return;
    }
    isDetailPage = tab.url.includes('willhaben.at') && new URL(tab.url).pathname.startsWith('/iad/');
    if (!isDetailPage) {
      statusMessage = 'Öffne eine willhaben.at-Anzeigedetailseite, um die Analyse zu sehen.';
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
      statusMessage = 'Anzeige noch nicht erfasst. Seite neu laden und erneut versuchen.';
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
      <p>Willhaben Auto-Preischeck</p>
    </div>
    <div class="metric">
      <span class="metric-label">Gespeicherte Anzeigen</span>
      <span class="metric-value">{totalCount}</span>
    </div>
  </header>
  <section class="freshness">
    <span class="label">Zuletzt erfasst</span>
    <span class="value">{formatDate(datasetLastCaptured)}</span>
  </section>

  <section class="analysis">
    <div class="metric-row">
      <span class="label">Datenaktionen</span>
    </div>
    <div class="action-row">
      <button class="action danger" on:click={clearAllData}>Alle Daten löschen</button>
      <button class="action" on:click={deleteCurrentListing} disabled={!activeListing}>Aktuelle Anzeige löschen</button>
    </div>
    <div class="action-row">
      <button class="action" on:click={() => downloadData('json')}>JSON exportieren</button>
      <button class="action" on:click={() => downloadData('csv')}>CSV exportieren</button>
      <button class="action" on:click={openImportDialog}>Importieren</button>
      <input
        class="file-input"
        type="file"
        accept="application/json"
        bind:this={importInput}
        on:change={handleImport}
      />
    </div>
    <div class="action-row">
      <label class="inline-input">
        <span>Älter als</span>
        <input type="number" min="1" bind:value={pruneDays} />
        <span>Tage</span>
      </label>
      <button class="action" on:click={pruneOlderThan}>Bereinigen</button>
    </div>
  </section>

  {#if showImportModal}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Importdialog schließen"
      on:click|self={cancelImport}
      on:keydown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') cancelImport();
      }}
    >
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h2 id="import-title">Importmodus wählen</h2>
        <p>
          Datei: <strong>{pendingImportName ?? 'Unbekannt'}</strong>
        </p>
        <p class="muted">
          Wähle, ob die Daten zusammengeführt oder die bestehenden Daten vollständig ersetzt werden sollen.
        </p>
        <div class="modal-actions">
          <button class="action" on:click={() => confirmImport('merge')}>Zusammenführen</button>
          <button class="action danger" on:click={() => confirmImport('replace')}>Ersetzen</button>
          <button class="action ghost" on:click={cancelImport}>Abbrechen</button>
        </div>
      </div>
    </div>
  {/if}

  {#if statusMessage}
    <section class="status">{statusMessage}</section>
  {:else if activeListing}
    <section class="listing">
      <h2>{activeListing.title}</h2>
      <div class="price">{formatEur(activeListing.price_eur)}</div>
      <div class="grid">
        <div>
          <span class="label">Marke</span>
          <span class="value">{formatText(activeListing.brand)}</span>
        </div>
        <div>
          <span class="label">Modell</span>
          <span class="value">{formatText(activeListing.model)}</span>
        </div>
        <div>
          <span class="label">Ausstattung</span>
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
        <div>
          <span class="label">Erstzulassung</span>
          <span class="value">{formatText(activeListing.erstzulassung)}</span>
        </div>
        <div>
          <span class="label">Treibstoff</span>
          <span class="value">{formatText(activeListing.fuel)}</span>
        </div>
        <div>
          <span class="label">Antrieb</span>
          <span class="value">{formatText(activeListing.drivetrain)}</span>
        </div>
        <div>
          <span class="label">Getriebeart</span>
          <span class="value">{formatText(activeListing.transmission)}</span>
        </div>
      </div>
    </section>

    <section class="analysis">
      <div class="metric-row">
        <span class="label">Vergleichbare Anzeigen</span>
        <span class="value">{analysis?.comparables_count ?? 0}</span>
      </div>
      <div class="metric-row">
        <span class="label">Datenbasis</span>
        <span class="value">{confidenceLabel()}</span>
      </div>
      {#if analysis?.not_enough_data}
        <div class="insufficient">Nicht genug Daten (mind. 10 vergleichbare Anzeigen nötig).</div>
      {:else}
        <div class="metric-row">
          <span class="label">Erwarteter Preis</span>
          <span class="value">{formatEur(analysis?.expected_price ?? null)}</span>
        </div>
        <div class="metric-row">
          <span class="label">Abweichung</span>
          <span class="value">
            {formatEur(analysis?.diff_eur ?? null)} ({formatPercent(analysis?.diff_pct ?? null)})
          </span>
        </div>
        <div class="score">
          <span>Angebots-Score</span>
          <strong class:positive={(analysis?.deal_score ?? 0) > 0} class:negative={(analysis?.deal_score ?? 0) < 0}>
            {formatPercent(analysis?.deal_score ?? null)}
          </strong>
        </div>
      {/if}
    </section>

    <section class="comps">
      <div class="metric-row">
        <span class="label">Vergleichbare Anzeigen</span>
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
        <div class="muted">Noch keine Vergleiche.</div>
      {/if}
    </section>

    <section class="history">
      <div class="metric-row">
        <span class="label">Preishistorie</span>
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
        <div class="muted">Noch keine Preisänderungen.</div>
      {/if}
    </section>
  {/if}

</main>
