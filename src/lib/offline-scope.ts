/**
 * Scoping rules for the offline download.
 *
 * The download used to be one fixed list: every layer's GeoJSON plus every
 * PMTiles archive, which is the right default but the wrong size for a metered
 * connection or a reader who only ever opens two layers. What gets fetched is
 * now decided from the build manifest (scripts/build-manifest.mjs), which
 * already records each layer's byte size and bbox, so the rules live here as
 * pure functions: parse once, intersect bboxes, flatten to fetch targets.
 *
 * The bbox is what makes "Current view" cheap: a layer whose data never
 * reaches the visible rectangle is not downloaded, without opening a byte of
 * it. Layers without a bbox (only possible for a malformed manifest entry) are
 * excluded from the viewport scope rather than assumed to be everywhere.
 *
 * PURE: no DOM, no fetch - testable under `node --test`.
 */

/** A bounding box as [minLon, minLat, maxLon, maxLat], the manifest's order. */
export type BBox = [number, number, number, number];

/** The map camera's footprint in degrees, as the panel receives it from its parent. */
export interface Viewport {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * What to fetch:
 *  - `all` - every layer in the manifest (the original behaviour);
 *  - `selected` - only the ids the reader ticked;
 *  - `viewport` - only layers whose bbox reaches the current map view.
 */
export type OfflineScope = "all" | "selected" | "viewport";

/** One manifest layer, reduced to the fields the offline download needs. */
export interface OfflineLayerEntry {
  id: string;
  label?: string;
  file?: string;
  pmtiles?: string;
  bytes: number;
  bbox?: BBox;
}

/** A parsed `/data/manifest.json`. */
export interface OfflineManifest {
  /** Build stamp, a date such as "2026-10-16", or null when absent. */
  generated: string | null;
  layers: OfflineLayerEntry[];
}

/** Coerce a value to a finite byte count; anything else counts as zero. */
function toBytes(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Coerce a value to a bbox, or undefined when it is not four finite numbers. */
function toBBox(value: unknown): BBox | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  const [a, b, c, d] = value;
  if (![a, b, c, d].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  return [a, b, c, d];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parse `/data/manifest.json` into download entries.
 *
 * Defensive on purpose: the manifest is build output, and a download button
 * that throws on a stray null layer is worse than one that skips it. Entries
 * that are not objects are dropped; missing sizes and bboxes degrade to 0 and
 * undefined so the rest of the layers still render.
 */
export function parseManifest(data: unknown): OfflineManifest {
  if (!data || typeof data !== "object") return { generated: null, layers: [] };
  const raw = data as Record<string, unknown>;
  const layers: OfflineLayerEntry[] = [];
  const layersRaw = raw.layers;
  if (layersRaw && typeof layersRaw === "object") {
    for (const [id, value] of Object.entries(layersRaw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      layers.push({
        id,
        label: optionalString(v.label),
        file: optionalString(v.file),
        pmtiles: optionalString(v.pmtiles),
        bytes: toBytes(v.bytes),
        bbox: toBBox(v.bbox),
      });
    }
  }
  return { generated: optionalString(raw.generated) ?? null, layers };
}

/**
 * Do two boxes touch at all?
 *
 * Shared edges count as intersecting: a layer clipped exactly along the view
 * boundary still contributes pixels, and manifest bboxes are rounded, so a
 * strict comparison would drop layers that are on screen.
 */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  // Standard axis-aligned bbox intersection: boxes intersect if they overlap in
  // both dimensions and do not touch only at the boundary? Manifest bboxes are
  // inclusive bounds; touching edges mean the layer covers the view edge - treat
  // as intersecting. Also ensure coordinates are compared correctly.
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** The panel's viewport shape as a manifest-style bbox. */
export function viewportToBBox(v: Viewport): BBox {
  return [v.west, v.south, v.east, v.north];
}

/**
 * The layers in scope, in manifest order (so progress and the checkbox list
 * stay in the same order the build wrote them).
 *
 * An empty or unknown selection yields nothing rather than everything: the
 * reader asked for specific layers, and silently downloading the whole island
 * because nothing was ticked is the costly mistake.
 *
 * `viewport` with no viewport supplied yields nothing too - the UI disables
 * that option instead, this is the defensive floor beneath it.
 */
export function scopeLayers(
  layers: readonly OfflineLayerEntry[],
  scope: OfflineScope,
  opts: { selected: readonly string[]; viewport: Viewport | null },
): OfflineLayerEntry[] {
  if (scope === "all") return [...layers];
  if (scope === "viewport") {
    if (!opts.viewport) return [];
    const view = viewportToBBox(opts.viewport);
    return layers.filter((l) => l.bbox !== undefined && bboxIntersects(l.bbox, view));
  }
  const picked = new Set(opts.selected);
  return layers.filter((l) => picked.has(l.id));
}

/** Total size of a set of entries, ignoring nonsensical (negative/NaN) sizes. */
export function totalBytes(layers: readonly OfflineLayerEntry[]): number {
  let total = 0;
  for (const l of layers) total += toBytes(l.bytes);
  return total;
}

const KB = 1024;
const MB = 1024 * 1024;

/**
 * A byte count the way a reader counts sizes: exact bytes below 1 KB, whole
 * KB below 1 MB, one decimal of MB above it. Rounded rather than truncated so
 * a 4.96 MB bundle does not claim to be 4.9 MB.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * The exact URLs a scoped download fetches, deduplicated.
 *
 * GeoJSON is requested under `/data/` because that is the path the service
 * worker caches into its data cache (public/sw.js) and the path the readiness
 * probe matches - the manifest stores bare file names, so the prefix has to be
 * added here. PMTiles paths resolve against the origin, which keeps the result
 * identical to what the map itself requests when it opens an archive.
 */
export function collectTargets(layers: readonly OfflineLayerEntry[], origin: string): string[] {
  const targets = new Set<string>();
  for (const l of layers) {
    if (l.file) targets.add(new URL(`data/${l.file}`, origin).toString());
    if (l.pmtiles) targets.add(new URL(l.pmtiles, origin).toString());
  }
  return [...targets];
}
