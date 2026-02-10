import type { Listing, ListingsMap } from './types';
import { mergeListing } from './parse';

const KEY = 'listings_v1';

export async function loadListings(): Promise<ListingsMap> {
  const result = await browser.storage.local.get(KEY);
  return (result[KEY] as ListingsMap) ?? {};
}

export async function saveListings(listings: ListingsMap): Promise<void> {
  await browser.storage.local.set({ [KEY]: listings });
}

export async function upsertListings(incoming: Listing[]): Promise<ListingsMap> {
  const listings = await loadListings();
  let changed = false;
  for (const item of incoming) {
    const existing = listings[item.id];
    const merged = mergeListing(existing, item);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(merged)) {
      listings[item.id] = merged;
      changed = true;
    }
  }
  if (changed) {
    await saveListings(listings);
  }
  return listings;
}

export async function countListings(): Promise<number> {
  const listings = await loadListings();
  return Object.keys(listings).length;
}

export async function getListing(id: string): Promise<Listing | null> {
  const listings = await loadListings();
  return listings[id] ?? null;
}
