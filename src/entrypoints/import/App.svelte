<script lang="ts">
  import type { Listing } from '../../lib/types';

  let fileName: string | null = null;
  let parsedCount = 0;
  let pendingImportListings: Listing[] = [];
  let importMode: 'merge' | 'replace' = 'merge';
  let isImporting = false;
  let statusMessage: string | null = null;

  function normalizeImportPayload(payload: unknown): Listing[] {
    if (Array.isArray(payload)) return payload as Listing[];
    if (!payload || typeof payload !== 'object') return [];
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.listings)) return obj.listings as Listing[];
    if (Array.isArray(obj.data)) return obj.data as Listing[];
    if (obj.listings && typeof obj.listings === 'object') {
      return Object.values(obj.listings as Record<string, Listing>);
    }
    if (obj.data && typeof obj.data === 'object') {
      return Object.values(obj.data as Record<string, Listing>);
    }
    return Object.values(obj).filter((item): item is Listing => !!item && typeof item === 'object');
  }

  async function handleFileChange(event: Event) {
    const input = (event.currentTarget ?? event.target) as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const listings = normalizeImportPayload(parsed).filter((item) => item && typeof item.id === 'string');
      if (!listings.length) {
        pendingImportListings = [];
        parsedCount = 0;
        fileName = file.name;
        statusMessage = 'Keine gueltigen Datensaetze mit String-ID gefunden.';
        return;
      }
      pendingImportListings = listings;
      parsedCount = listings.length;
      fileName = file.name;
      statusMessage = `${listings.length} Datensaetze bereit fuers Importieren.`;
    } catch (error) {
      console.error('Import parse failed', error);
      pendingImportListings = [];
      parsedCount = 0;
      fileName = file.name;
      statusMessage = 'Datei ist kein gueltiges JSON.';
    } finally {
      if (input) input.value = '';
    }
  }

  async function runImport() {
    if (!pendingImportListings.length || isImporting) return;
    isImporting = true;
    statusMessage = null;
    try {
      const response = await browser.runtime.sendMessage({
        type: 'import_listings',
        listings: pendingImportListings,
        mode: importMode,
      });
      if (!response?.ok) {
        statusMessage = 'Import fehlgeschlagen. Bitte erneut versuchen.';
        return;
      }
      const importedCount = response.imported ?? pendingImportListings.length;
      statusMessage =
        importMode === 'replace'
          ? `Import abgeschlossen: ${importedCount} Anzeigen ersetzt.`
          : `Import abgeschlossen: ${importedCount} Anzeigen zusammengefuehrt.`;
    } catch (error) {
      console.error('Import request failed', error);
      statusMessage = 'Import fehlgeschlagen. Hintergrundskript nicht erreichbar.';
    } finally {
      isImporting = false;
    }
  }
</script>

<main>
  <header>
    <h1>DealGauge JSON Import</h1>
    <p>Waehle die zuvor exportierte JSON-Datei.</p>
  </header>

  <section class="panel">
    <label class="file-label" for="import-file">JSON-Datei auswaehlen</label>
    <input id="import-file" type="file" accept="application/json" on:change={handleFileChange} />

    <div class="meta">
      <div>Datei: <strong>{fileName ?? 'Keine'}</strong></div>
      <div>Erkannte Datensaetze: <strong>{parsedCount}</strong></div>
    </div>

    <label class="mode">
      Importmodus
      <select bind:value={importMode}>
        <option value="merge">Zusammenfuehren</option>
        <option value="replace">Ersetzen</option>
      </select>
    </label>

    <button class="action" on:click={runImport} disabled={!pendingImportListings.length || isImporting}>
      {isImporting ? 'Import laeuft...' : 'Import starten'}
    </button>

    {#if statusMessage}
      <p class="status">{statusMessage}</p>
    {/if}
  </section>
</main>
