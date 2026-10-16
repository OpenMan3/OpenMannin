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
  generated: string;
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
  const scored: { score: number; seq: number; result: SearchResult }[] = [];
  const seen = new Set<string>();

  index.entries.forEach((entry, seq) => {
    const [li, label, lon, lat] = entry;
    const lower = label.toLowerCase();
    if (!lower.includes(q)) return;

    const layer = index.layers[li];
    if (!layer) return;
    const key = `${layer.id}\u0000${lower}`;
    if (seen.has(key)) return;
    seen.add(key);

    const score = lower.startsWith(q) ? 0 : boundary.test(lower) ? 1 : 2;
    scored.push({
      score,
      seq,
      result: { layerId: layer.id, layerLabel: layer.label, label, lon, lat },
    });
  });

  scored.sort((a, b) => a.score - b.score || a.seq - b.seq);
  return scored.slice(0, limit).map((s) => s.result);
}
