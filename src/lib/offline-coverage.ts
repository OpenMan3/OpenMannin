/**
 * Offline coverage: what a reader has actually cached, and where it lands.
 *
 * `offline-scope.ts` decides what to fetch; this module answers the other half
 * of the question - after a download (or on a later visit), how much of the
 * manifest is present, and what footprint does it cover? The service worker's
 * caches are the source of truth for "present"; the manifest's per-layer bbox
 * gives the footprint, so the cached set can be drawn on the map without
 * opening a single geometry.
 *
 * PURE: no DOM, no fetch. The cache lookups happen in the component; the shapes
 * assembled from their result live here so they can be tested under `node
 * --test`.
 */

import type { BBox, OfflineLayerEntry } from "./offline-scope.ts";

/** How much of the manifest is cached, and how many bytes that is. */
export interface CoverageSummary {
  cachedLayers: number;
  totalLayers: number;
  cachedBytes: number;
}

/**
 * Count the cached layers and sum their declared bytes. A layer counts as
 * cached only when its id is in `cachedIds`; ids that match no layer are
 * ignored, so a stale stored selection cannot inflate the total.
 */
export function summarizeCoverage(
  layers: readonly OfflineLayerEntry[],
  cachedIds: ReadonlySet<string>,
): CoverageSummary {
  let cachedLayers = 0;
  let cachedBytes = 0;
  for (const l of layers) {
    if (!cachedIds.has(l.id)) continue;
    cachedLayers += 1;
    if (typeof l.bytes === "number" && Number.isFinite(l.bytes) && l.bytes > 0) {
      cachedBytes += l.bytes;
    }
  }
  return { cachedLayers, totalLayers: layers.length, cachedBytes };
}

/**
 * A closed ring for a bbox, optionally padded outward so adjacent outlines are
 * distinguishable at low zoom. The ring is [lon, lat] pairs in GeoJSON order
 * and repeats its first vertex to close.
 */
export function bboxPolygon(b: BBox, pad = 0): [number, number][] {
  const [minLon, minLat, maxLon, maxLat] = b;
  const west = minLon - pad;
  const south = minLat - pad;
  const east = maxLon + pad;
  const north = maxLat + pad;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** A minimal GeoJSON Feature, enough to hand to MapLibre as a source. */
export interface CoverageFeature {
  type: "Feature";
  id: string;
  properties: { id: string; label: string; bytes: number };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
}

export interface CoverageFeatureCollection {
  type: "FeatureCollection";
  features: CoverageFeature[];
}

/**
 * The cached layers as a FeatureCollection of their bounding boxes, ready to
 * draw. Layers without a bbox (malformed manifest entry) are skipped rather
 * than guessed at; the `id` on the feature is the layer id, and its properties
 * carry the label and byte size for a popup or tooltip.
 */
export function coverageFeatureCollection(
  layers: readonly OfflineLayerEntry[],
  cachedIds: ReadonlySet<string>,
  pad = 0,
): CoverageFeatureCollection {
  const features: CoverageFeature[] = [];
  for (const l of layers) {
    if (!cachedIds.has(l.id) || !l.bbox) continue;
    features.push({
      type: "Feature",
      id: l.id,
      properties: {
        id: l.id,
        label: l.label ?? l.id,
        bytes: typeof l.bytes === "number" && Number.isFinite(l.bytes) && l.bytes > 0 ? l.bytes : 0,
      },
      geometry: { type: "Polygon", coordinates: [bboxPolygon(l.bbox, pad)] },
    });
  }
  return { type: "FeatureCollection", features };
}
