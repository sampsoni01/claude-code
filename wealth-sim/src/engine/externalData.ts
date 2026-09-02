import type { ExternalListing, SourceInfo, Money, AssetCategory, ISODate } from './types';
import { CATALOG, CATALOG_SOURCE, type CatalogItem } from './catalog';

/**
 * External data layer. The simulation prefers data in this order:
 *   1. official API / structured data   2. manufacturer / dealer / broker / marketplace
 *   3. reputable public web             4. comparable market data
 *   5. AI-calculated estimate           6. user-defined value
 * Each provider declares which tier it is; results always carry SourceInfo.
 *
 * The built-in provider serves the reference catalog. A browser build has no
 * server, so live web retrieval is pluggable: register a provider that calls
 * your own backend, or import a listing manually (pasted from a real page).
 */
export interface AssetSearchResult {
  name: string;
  category: AssetCategory;
  price: Money;
  listing: ExternalListing;
  catalogItem?: CatalogItem;
}

export interface DataProvider {
  id: string;
  tier: 1 | 2 | 3 | 4 | 5;
  label: string;
  search(query: string, opts?: { category?: AssetCategory; maxPrice?: Money; location?: string }): Promise<AssetSearchResult[]>;
  /** Optional: fresh valuation estimate for an existing asset by description. */
  estimateValue?(description: string, category: AssetCategory, purchasePrice: Money, purchaseDate: ISODate): Promise<{ value: Money; source: SourceInfo } | null>;
}

export const builtinProvider: DataProvider = {
  id: 'builtin',
  tier: 4,
  label: 'Built-in reference catalog',
  async search(query, opts) {
    const q = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    return CATALOG.filter((c) => (!opts?.category || c.category === opts.category) && (!opts?.maxPrice || c.price <= opts.maxPrice))
      .map((c) => ({ c, score: q.reduce((s, w) => s + (`${c.name} ${c.tags.join(' ')}`.toLowerCase().includes(w) ? 1 : 0), 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ c }) => ({ name: c.name, category: c.category, price: c.price, catalogItem: c, listing: { source: { ...CATALOG_SOURCE, range: c.range }, listingPrice: c.price, specifications: flattenDetails(c) } }));
  },
};

function flattenDetails(c: CatalogItem): Record<string, string | number> {
  const d = c.details as any;
  const inner = d[d.kind] ?? d.fields ?? {};
  return Object.fromEntries(Object.entries(inner).filter(([, v]) => typeof v === 'string' || typeof v === 'number')) as Record<string, string | number>;
}

const providers: DataProvider[] = [builtinProvider];

export function registerProvider(p: DataProvider): void {
  if (!providers.find((x) => x.id === p.id)) providers.push(p);
  providers.sort((a, b) => a.tier - b.tier);
}

export function listProviders(): DataProvider[] { return [...providers]; }

/** Queries providers best-tier first; returns the first non-empty result set plus which provider served it. */
export async function searchAssets(query: string, opts?: { category?: AssetCategory; maxPrice?: Money; location?: string }): Promise<{ results: AssetSearchResult[]; provider: DataProvider | null }> {
  for (const p of providers) {
    try {
      const r = await p.search(query, opts);
      if (r.length) return { results: r, provider: p };
    } catch { /* provider failure falls through to next tier */ }
  }
  return { results: [], provider: null };
}

/** Builds a listing snapshot from user-pasted real-world data (manual import). */
export function manualListing(input: { price: Money; sourceLabel: string; url?: string; retrievedOn: ISODate; location?: string; specifications?: Record<string, string | number>; fees?: Record<string, Money>; listingId?: string }): ExternalListing {
  return {
    source: { type: 'retrieved_real_world', label: input.sourceLabel, reference: input.url, retrievedOn: input.retrievedOn, confidence: 0.9, notes: 'Imported by user from an external listing' },
    listingPrice: input.price,
    location: input.location,
    specifications: input.specifications,
    fees: input.fees,
    listingId: input.listingId,
  };
}
