import { analyzeListing } from '../lib/compare';
import {
  clearAllListings,
  countListings,
  deleteListing,
  getListing,
  loadListings,
  pruneListingsOlderThan,
  upsertListings,
} from '../lib/storage';
import type { Listing } from '../lib/types';

type Message =
  | { type: 'upsert_listings'; listings: Listing[] }
  | { type: 'get_count' }
  | { type: 'get_listing'; id: string }
  | { type: 'get_analysis'; id: string }
  | { type: 'get_export' }
  | { type: 'analyze_listings'; listings: Listing[] }
  | { type: 'clear_all' }
  | { type: 'delete_listing'; id: string }
  | { type: 'prune_older_than'; days: number };

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message) => {
    if (message?.type === 'upsert_listings') {
      return upsertListings(message.listings).then((listings) => ({
        ok: true,
        count: Object.keys(listings).length,
      }));
    }

    if (message?.type === 'get_count') {
      return loadListings().then((listings) => {
        const items = Object.values(listings);
        const lastCaptured = items
          .map((item) => item.captured_at)
          .sort()
          .slice(-1)[0];
        return { ok: true, count: items.length, last_captured: lastCaptured ?? null };
      });
    }

    if (message?.type === 'get_listing') {
      return getListing(message.id).then((listing) => ({ ok: true, listing }));
    }

    if (message?.type === 'get_analysis') {
      return Promise.all([getListing(message.id), loadListings()]).then(([listing, listings]) => {
        if (!listing) {
          return { ok: true, listing: null, analysis: null };
        }
        const analysis = analyzeListing(listing, listings);
        return { ok: true, listing, analysis };
      });
    }

    if (message?.type === 'get_export') {
      return loadListings().then((listings) => ({
        ok: true,
        listings: Object.values(listings),
      }));
    }

    if (message?.type === 'analyze_listings') {
      return loadListings().then((listings) => {
        const analyses = message.listings.map((listing) => ({
          id: listing.id,
          analysis: analyzeListing(listing, listings),
        }));
        return { ok: true, analyses };
      });
    }

    if (message?.type === 'clear_all') {
      return clearAllListings().then(() => ({ ok: true }));
    }

    if (message?.type === 'delete_listing') {
      return deleteListing(message.id).then((removed) => ({ ok: true, removed }));
    }

    if (message?.type === 'prune_older_than') {
      return pruneListingsOlderThan(message.days).then((removed) => ({ ok: true, removed }));
    }

    return Promise.resolve({ ok: false });
  });
});
