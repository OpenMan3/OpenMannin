/**
 * Static GeoJSON layer sync and paint layer registration.
 *
 * This module handles adding/removing static data layers (from the layer
 * registry) to the MapLibre map. It is called on mount, on basemap change
 * (style.load), and when layer visibility toggles.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerDef } from "@/lib/types";
import { geometryKindsOf, loadLayer, type GeometryKind } from "@/lib/layer-data";
import { pmtilesSource } from "@/lib/layer-source";
import { GEOMETRY_FILTER, PAINT_SUFFIXES } from "@/lib/geometry-filter";

export { PAINT_SUFFIXES };

export const layerIdFor = (id: string, suffix: string) => `om-${id}-${suffix}`;

/**
 * Vector-tile sources have no loaded FeatureCollection to inspect, so every
 * paint layer is registered; the per-suffix GEOMETRY_FILTER keeps each one to
 * the geometry it can draw (see geometry-filter.ts).
 */
const ALL_KINDS: ReadonlySet<GeometryKind> = new Set(["point", "line", "polygon"]);

/**
 * Per-category point styling.
 *
 * The registry sets each layer's colour; this adds a little shape so the two
 * similar POI layers (a mine and a picnic site are both circles today) do not
 * read identically. Keyed by layer id, and deliberately small: a layer that is
 * not listed falls back to the standard marker.
 */
const BUILDING_VISUAL: Record<string, { fill: number; line: number; lineColor?: string }> = {
  // Buildings are the densest layer on the map. A slightly lighter fill under a
  // darker outline is what makes a footprint read as an outlined footprint
  // rather than a faint smudge - the registry colour is light enough to vanish
  // against the basemap as a line.
  buildings: { fill: 0.28, line: 1.4, lineColor: "#6b7280" },
  // Parish boundaries cover large areas; a very light fill vanishes against the
  // basemap so only the dark outlines are visible, looking like a mesh of
  // unconnected lines. Raise the fill so each parish reads as a filled region.
  "parish-boundaries": { fill: 0, line: 1.2, lineColor: "#6366f1" },
};

const POINT_STYLE: Record<string, { radius: number; stroke: string; strokeWidth: number }> = {
  // Mine features are the one POI category that is an outright hazard, so they
  // get a heavier, darker ring that stands out from the benign layers.
  "mine-infrastructure": { radius: 6, stroke: "#111827", strokeWidth: 1.8 },
  "tholtans-ruins": { radius: 4, stroke: "#ffffff", strokeWidth: 1 },
  "essential-utilities": { radius: 5, stroke: "#ffffff", strokeWidth: 1 },
  "food-drink": { radius: 5, stroke: "#ffffff", strokeWidth: 1 },
  "coastal-outdoor": { radius: 4, stroke: "#ffffff", strokeWidth: 1 },
};

/**
 * Resolve a clicked MapLibre layer id back to its registry entry.
 *
 * Ids are `om-<registry id>-<geometry suffix>`, so both the namespace prefix
 * and the suffix have to be removed. Forgetting the prefix silently makes every
 * click miss, which looks exactly like dead map.
 */
export function layerByMapLayerId(mapLayerId: string, defs: LayerDef[]): LayerDef | undefined {
  const match = /^om-(.+)-(fill|line|circle|symbol)$/.exec(mapLayerId);
  if (!match) return undefined;
  return defs.find((l) => l.id === match[1]);
}

/**
 * Add paint layers for a static GeoJSON layer, one per geometry kind present.
 *
 * `minZoom` is pushed onto each layer so the registry's zoom guidance is
 * enforced by the renderer rather than by convention.
 */
export function addPaintLayers(
  map: MapLibreMap,
  def: LayerDef,
  kinds: ReadonlySet<GeometryKind>,
): void {
  const id = `om-${def.id}`;
  const minzoom = def.minZoom ?? 0;

  // Vector (PMTiles) sources keep their members under a source-layer that must
  // be named when the layer is added; GeoJSON sources do not. Detect by source.
  const src = map.getSource(id);
  const isVector = src?.type === "vector";
  const sourceLayer = isVector ? { "source-layer": def.id } : {};

  const visual = BUILDING_VISUAL[def.id] ?? { fill: 0.22, line: 1.5 };
  const lineColor = visual.lineColor ?? def.color;

  if (visual.fill > 0 && kinds.has("polygon")) {
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      minzoom,
      filter: GEOMETRY_FILTER.fill,
      ...sourceLayer,
      paint: { "fill-color": def.color, "fill-opacity": visual.fill },
    });
  }

  // Exactly ONE line layer, covering both jobs: outlining polygon features and
  // drawing line-string features (roads, streams, cables...). Separate layers
  // for each kind would require complex layer-order gymnastics; a single line
  // layer with minzoom handles both because MapLibre skips features whose
  // geometry type does not match the layer type.
  if (kinds.has("line") || kinds.has("polygon")) {
    map.addLayer({
      id: `${id}-line`,
      type: "line",
      source: id,
      minzoom,
      filter: GEOMETRY_FILTER.line,
      ...sourceLayer,
      paint: { "line-color": lineColor, "line-width": visual.line, "line-opacity": 0.85 },
    });
  }

  if (kinds.has("point")) {
    const ps = POINT_STYLE[def.id] ?? { radius: 5, stroke: "#ffffff", strokeWidth: 1 };
    map.addLayer({
      id: `${id}-circle`,
      type: "circle",
      source: id,
      minzoom,
      filter: GEOMETRY_FILTER.circle,
      ...sourceLayer,
      paint: {
        "circle-radius": ps.radius,
        "circle-color": def.color,
        "circle-stroke-color": ps.stroke,
        "circle-stroke-width": ps.strokeWidth,
        "circle-opacity": 0.9,
      },
    });
  }

  // Symbol (label) layer. Coalesce the identity-ish fields so an unnamed
  // building still reads from its class/subtype instead of staying blank.
  // Points, and polygons at close zoom, can carry a label.
  const symbolZoom = def.minZoom ? Math.max(def.minZoom, 15) : 15;
  if (kinds.has("polygon") || kinds.has("point")) {
    map.addLayer({
      id: `${id}-symbol`,
      type: "symbol",
      source: id,
      minzoom: symbolZoom,
      filter: GEOMETRY_FILTER.symbol,
      ...sourceLayer,
      layout: {
        "text-field": ["coalesce", ["get", "name"], ["get", "purpose"], ["get", "subtype"], ["get", "buildingClass"], ""],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-anchor": "top",
        "text-offset": [0, 0.5],
        "text-max-width": 9,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#1f2937",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.2,
        "text-halo-blur": 0.5,
      },
    });
  }
}

export function removeLayer(map: MapLibreMap, layerId: string): void {
  const id = `om-${layerId}`;
  for (const suffix of PAINT_SUFFIXES) {
    const lid = `${id}-${suffix}`;
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  if (map.getSource(id)) map.removeSource(id);
}

/**
 * The live state a sync reads while it runs.
 *
 * These are refs, not values, on purpose. A load can outlast a toggle, and a
 * snapshot taken when the sync started is exactly the bug: the fetch finishes,
 * re-checks the state it was handed, sees itself as still enabled, and paints a
 * layer the user switched off a moment ago. Reading `current` at the moment of
 * the decision makes a late-arriving load see the truth.
 */
export interface StaticLayerSyncState {
  /** Ids the user has switched on, read fresh after each await. */
  enabledRef: { current: Set<string> };
  /** Ids whose data could not be loaded, read fresh after each await. */
  missingRef: { current: Set<string> };
  /** Report a layer as loadable or not, so the panel can grey it out. */
  onMissing?: (id: string, missing: boolean) => void;
  /** Report the collection's `generated` stamp for the details card. */
  onAsOf?: (id: string, asOf: string | undefined) => void;
}

/**
 * Sync all static layers from the registry to the map.
 *
 * - Layers that are enabled and have data: add source + paint layers
 * - Layers that are disabled or missing data: remove
 * - Also removes any orphaned sources/layers not in the current registry
 */
export async function syncStaticLayers(
  map: MapLibreMap,
  layers: LayerDef[],
  state: StaticLayerSyncState,
): Promise<void> {
  const { enabledRef, missingRef, onMissing, onAsOf } = state;

  /** Is the layer wanted right now, given the latest enabled/missing sets? */
  const wanted = (def: LayerDef) =>
    enabledRef.current.has(def.id) && !missingRef.current.has(def.id);

  // Track which source IDs should exist after sync
  const expectedSourceIds = new Set<string>();

  for (const def of layers) {
    // Skip live layers - they are handled by map-live.ts
    if (def.kind === "live") continue;

    const id = `om-${def.id}`;

    if (!wanted(def)) {
      removeLayer(map, def.id);
      continue;
    }

    expectedSourceIds.add(id);

    // Skip if already present
    if (map.getSource(id)) continue;

    // Prefer a build-time PMTiles archive when the registry points at one.
    // The map streams only the tiles it needs; the GeoJSON `file` stays as the
    // ingest/offline fallback and is what FeatureBrowser keeps reading.
    const vectorSource = pmtilesSource(def);
    // Offline, tile archives may not be cached, so take the cached GeoJSON
    // path instead; the tiles are streamed only while the map is online.
    const preferGeojson = typeof navigator !== "undefined" && navigator.onLine === false;
    if (vectorSource && !preferGeojson) {
      try {
        map.addSource(id, vectorSource);
        addPaintLayers(map, def, ALL_KINDS);
        onMissing?.(def.id, false);
        continue;
      } catch (e) {
        console.warn(`[sync] ${def.id} pmtiles failed; falling back to geojson`, (e as Error).message);
      }
    }

    try {
      const fc = await loadLayer(def.file!);

      // The fetch can outlast a toggle. Re-read the CURRENT state: adding a
      // layer switched off while the request was in the air would paint a
      // layer the panel says is hidden, and nothing would remove it until the
      // user toggled it on and off again.
      if (!wanted(def)) continue;

      const kinds = geometryKindsOf(fc);
      if (kinds.size === 0) {
        onMissing?.(def.id, false);
        continue;
      }

      // A concurrent sync may have added it while this one was awaiting.
      if (!map.getSource(id)) {
        map.addSource(id, { type: "geojson", data: fc as never });
        addPaintLayers(map, def, kinds);
      }

      const asOf = fc.properties?.generated;
      onAsOf?.(def.id, typeof asOf === "string" ? asOf : undefined);
      // Success clears an earlier failure, so one flaky request does not keep
      // the layer greyed out as "no data" for the rest of the session.
      onMissing?.(def.id, false);
    } catch (e) {
      // A layer the registry lists but public/data does not have must not take
      // the map down. Record it so the panel greys it out.
      onMissing?.(def.id, true);
      console.warn(`[sync] ${def.id}:`, (e as Error).message);
    }
  }

  // Remove true orphans: an `om-` source that is neither expected this pass nor
  // one of the dynamic overlays (navigation markers `om-nav-*`, the measure
  // tool `om-measure`) or a live feed. Disabled static layers are already
  // removed in the loop above; this catches a source left behind when a layer
  // is deleted from the registry, which the old `registryIds.has(...)` guard
  // (built from the same registry) could never do.
  const liveIds = new Set(layers.filter((l) => l.kind === "live").map((l) => `om-${l.id}`));
  const style = map.getStyle();
  for (const sourceId of Object.keys(style.sources)) {
    if (!sourceId.startsWith("om-")) continue;
    if (expectedSourceIds.has(sourceId) || liveIds.has(sourceId)) continue;
    if (
      sourceId === "om-measure" ||
      sourceId === "om-coverage" ||
      sourceId.startsWith("om-nav-")
    )
      continue;
    removeLayer(map, sourceId.slice(3)); // remove "om-" prefix
  }
}