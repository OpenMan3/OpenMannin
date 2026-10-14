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

export const layerIdFor = (id: string, suffix: string) => `om-${id}-${suffix}`;

/** Every paint layer suffix a registry layer can be split into. */
export const PAINT_SUFFIXES = ["fill", "line", "circle", "symbol"] as const;

/**
 * Vector-tile sources have no loaded FeatureCollection to inspect, so every
 * paint layer is registered. MapLibre skips features whose geometry does not
 * match the layer type, so a circle layer over line features is a no-op rather
 * than a bug - the same trick the line layer already relies on for polygons.
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

  if (kinds.has("polygon")) {
    map.addLayer({
      id: `${id}-fill`,
      type: "fill",
      source: id,
      minzoom,
      paint: { "fill-color": def.color, "fill-opacity": 0.22 },
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
      paint: { "line-color": def.color, "line-width": 1.5, "line-opacity": 0.85 },
    });
  }

  if (kinds.has("point")) {
    const ps = POINT_STYLE[def.id] ?? { radius: 5, stroke: "#ffffff", strokeWidth: 1 };
    map.addLayer({
      id: `${id}-circle`,
      type: "circle",
      source: id,
      minzoom,
      paint: {
        "circle-radius": ps.radius,
        "circle-color": def.color,
        "circle-stroke-color": ps.stroke,
        "circle-stroke-width": ps.strokeWidth,
        "circle-opacity": 0.9,
      },
    });
  }

  // Symbol (label) layer for named point features
  // Check if any point feature has a name property
  if (kinds.has("point")) {
    // We can't easily check at this level if points have names,
    // so we add the symbol layer for all point layers and let
    // the text-field expression handle empty names
    map.addLayer({
      id: `${id}-symbol`,
      type: "symbol",
      source: id,
      minzoom,
      layout: {
        "text-field": ["coalesce", ["get", "name"], ""],
        "text-font": ["Noto Sans Regular"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.6],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": "#0b0f14",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
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
    if (vectorSource) {
      map.addSource(id, vectorSource);
      addPaintLayers(map, def, ALL_KINDS);
      onMissing?.(def.id, false);
      continue;
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

  // Remove orphaned sources/layers (exist on map but not in enabled registry)
  const registryIds = new Set(layers.filter((l) => l.kind !== "live").map((l) => `om-${l.id}`));
  const style = map.getStyle();
  for (const sourceId of Object.keys(style.sources)) {
    if (sourceId.startsWith("om-") && !expectedSourceIds.has(sourceId) && registryIds.has(sourceId)) {
      removeLayer(map, sourceId.slice(3)); // remove "om-" prefix
    }
  }
}