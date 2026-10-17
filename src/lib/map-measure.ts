/**
 * Measurement overlay on the MapLibre map.
 *
 * The maths and the point list live in src/lib/measure.ts (pure, tested under
 * node). This module is the browser half: it paints the collected points as a
 * dashed polyline with vertex dots on top of the data layers.
 *
 * WHY A MODULE, NOT MARKERS. A style swap (dark/light toggle, WebGL restore)
 * tears down every source and layer, so a one-off add at mount would vanish the
 * first time the basemap changed. MapView already re-syncs static layers on
 * style load; this slots into the same lifecycle, and `syncMeasure` is
 * idempotent so it is safe to call on every change.
 *
 * The source id carries the `om-` namespace but no geometry suffix, so a stray
 * click cannot be mistaken for a registry layer (see layerByMapLayerId) and the
 * static-layer orphan sweep leaves it alone (it only removes known registry
 * ids).
 */

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { MeasurePoint } from "@/lib/measure";
import { GEOMETRY_FILTER } from "@/lib/geometry-filter";

export const MEASURE_SOURCE_ID = "om-measure";
export const MEASURE_LINE_LAYER_ID = "om-measure-line";
export const MEASURE_VERTEX_LAYER_ID = "om-measure-vertex";

/** The map's info blue, visible against both the light and the dark basemap. */
const ACCENT = "#1a73e8";

function featureCollection(points: MeasurePoint[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = points.map((p, index) => ({
    type: "Feature",
    properties: { index },
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
  }));

  if (points.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lon, p.lat]),
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/**
 * Create or update the measurement source and its two paint layers.
 *
 * Idempotent: an existing source is re-fed via `setData` (no flicker), and each
 * layer is added only once. Call it whenever the points change and after a
 * style load.
 */
export function syncMeasure(map: MapLibreMap, points: MeasurePoint[]): void {
  const data = featureCollection(points);

  const existing = map.getSource(MEASURE_SOURCE_ID);
  if (existing && existing.type === "geojson") {
    (existing as GeoJSONSource).setData(data);
  } else if (!existing) {
    map.addSource(MEASURE_SOURCE_ID, { type: "geojson", data });
  }

  // Line first, vertices second: later layers paint on top, so the dots sit
  // above the line rather than being half-covered by it.
  if (!map.getLayer(MEASURE_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_LINE_LAYER_ID,
      type: "line",
      source: MEASURE_SOURCE_ID,
      filter: GEOMETRY_FILTER.line,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ACCENT,
        "line-width": 2.5,
        "line-opacity": 0.9,
        // Dashed, so a measured line never reads as a data feature or a route.
        "line-dasharray": [2, 1.5],
      },
    });
  }

  if (!map.getLayer(MEASURE_VERTEX_LAYER_ID)) {
    map.addLayer({
      id: MEASURE_VERTEX_LAYER_ID,
      type: "circle",
      source: MEASURE_SOURCE_ID,
      filter: GEOMETRY_FILTER.circle,
      paint: {
        "circle-radius": 5,
        "circle-color": "#ffffff",
        "circle-stroke-color": ACCENT,
        "circle-stroke-width": 2.5,
      },
    });
  }
}
