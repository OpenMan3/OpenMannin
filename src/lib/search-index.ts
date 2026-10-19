/**
 * Global cross-layer search.
 *
 * Reads the compact index built by scripts/build-search-index.mjs - only
 * identity-bearing features, as [layerIndex, label, lon, lat] - and ranks
 * matches so a prefix match beats a mid-word one. The index is fetched once
 * per session and cached.
 *
 * Pure logic (searchIndex) is separated from the fetch so it is unit-testable.
 */

export interface SearchIndex {
  /** Optional: the builder deliberately omits a volatile timestamp. */
  generated?: string;
  layers: { id: string; label: string }[];
  entries: [number, string, number, number][];
}

export interface SearchResult {
  layerId: string;
  layerLabel: string;
  label: string;
  lon: number;
  lat: number;
}

let cache: SearchIndex | null = null;
let inflight: Promise<SearchIndex> | null = null;

export async function loadSearchIndex(): Promise<SearchIndex> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      try {
        const res = await fetch("/data/search-index.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status} for /data/search-index.json`);
        const idx = (await res.json()) as SearchIndex;
        cache = idx;
        return idx;
      } finally {
        // Always clear the in-flight entry: caching only on success left a
        // rejected promise in `inflight` for good, so one transient failure
        // (first keystroke offline, a 5xx) broke search until a full reload.
        inflight = null;
      }
    })();
  }
  return inflight;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rank matches: a label starting with the query first, then a word-boundary
 * match, then any substring. Duplicate (layer, label) pairs collapse to one
 * result, since a road broken into 50 ways should not fill the list.
 */
export function searchIndex(index: SearchIndex, query: string, limit = 30): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const boundary = new RegExp(`(^|\\W)${escapeRegExp(q)}`);
  // Three score buckets, filled in iteration (seq) order. Because bucket 0
  // (prefix matches) outranks everything, once it holds `limit` entries no
  // later match can enter the result, so the scan can stop. This avoids
  // sorting every match on each keystroke, which for a two-letter query over
  // the whole index was thousands of comparisons.
  const buckets: SearchResult[][] = [[], [], []];
  const seen = new Set<string>();

  for (const [li, label, lon, lat] of index.entries) {
    if (buckets[0].length >= limit) break;
    const lower = label.toLowerCase();
    if (!lower.includes(q)) continue;

    const layer = index.layers[li];
    if (!layer) continue;
    const key = `${layer.id}\u0000${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const score = lower.startsWith(q) ? 0 : boundary.test(lower) ? 1 : 2;
    buckets[score].push({ layerId: layer.id, layerLabel: layer.label, label, lon, lat });
  }

  return [...buckets[0], ...buckets[1], ...buckets[2]].slice(0, limit);
}
