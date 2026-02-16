import type { Listing } from '../../lib/types';

const fileInput = document.getElementById('import-file') as HTMLInputElement | null;
const modeSelect = document.getElementById('import-mode') as HTMLSelectElement | null;
const importButton = document.getElementById('import-btn') as HTMLButtonElement | null;
const fileNameEl = document.getElementById('file-name');
const parsedCountEl = document.getElementById('parsed-count');
const statusEl = document.getElementById('status');

let pendingImportListings: Listing[] = [];
let isImporting = false;

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function setFileName(name: string): void {
  if (fileNameEl) fileNameEl.textContent = name;
}

function setParsedCount(count: number): void {
  if (parsedCountEl) parsedCountEl.textContent = String(count);
}

function refreshButtonState(): void {
  if (importButton) importButton.disabled = !pendingImportListings.length || isImporting;
}

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

async function handleFileChange(event: Event): Promise<void> {
  const input = (event.currentTarget ?? event.target) as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  setFileName(file.name);
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const listings = normalizeImportPayload(parsed).filter((item) => item && typeof item.id === 'string');
    if (!listings.length) {
      pendingImportListings = [];
      setParsedCount(0);
      setStatus('Keine gueltigen Datensaetze mit String-ID gefunden.');
      refreshButtonState();
      return;
    }
    pendingImportListings = listings;
    setParsedCount(listings.length);
    setStatus(`${listings.length} Datensaetze bereit fuers Importieren.`);
    refreshButtonState();
  } catch (error) {
    console.error('Import parse failed', error);
    pendingImportListings = [];
    setParsedCount(0);
    setStatus('Datei ist kein gueltiges JSON.');
    refreshButtonState();
  } finally {
    if (input) input.value = '';
  }
}

async function runImport(): Promise<void> {
  if (!pendingImportListings.length || isImporting) return;
  const mode = (modeSelect?.value === 'replace' ? 'replace' : 'merge') as 'merge' | 'replace';
  isImporting = true;
  refreshButtonState();
  setStatus('Import laeuft...');
  try {
    const response = await browser.runtime.sendMessage({
      type: 'import_listings',
      listings: pendingImportListings,
      mode,
    });
    if (!response?.ok) {
      setStatus('Import fehlgeschlagen. Bitte erneut versuchen.');
      return;
    }
    const importedCount = response.imported ?? pendingImportListings.length;
    setStatus(
      mode === 'replace'
        ? `Import abgeschlossen: ${importedCount} Anzeigen ersetzt.`
        : `Import abgeschlossen: ${importedCount} Anzeigen zusammengefuehrt.`,
    );
  } catch (error) {
    console.error('Import request failed', error);
    setStatus('Import fehlgeschlagen. Hintergrundskript nicht erreichbar.');
  } finally {
    isImporting = false;
    refreshButtonState();
  }
}

if (fileInput) fileInput.addEventListener('change', handleFileChange);
if (importButton) importButton.addEventListener('click', () => void runImport());
setStatus('Bereit. Bitte eine JSON-Datei auswaehlen.');
refreshButtonState();
