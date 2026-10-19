/**
 * Offline coverage overlay on the MapLibre map.
 *
 * The shapes are built in src/lib/offline-coverage.ts (pure, tested under
 * node); this is the browser half: it draws the bounding boxes of the layers
 * that are cached for offline use, so a reader can see at a glance what area
 * the download actually covers.
 *
 * Same lifecycle reasoning as src/lib/map-measure.ts: a style swap tears down
 * every source and layer, so this is idempotent and re-applied on style load
 * rather than added once. The `om-coverage` source is left alone by the
 * static-layer orphan sweep (map-layers.ts), which only removes registry ids.
 */

import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { CoverageFeatureCollection } from "@/lib/offline-coverage";

export const COVERAGE_SOURCE_ID = "om-coverage";
export const COVERAGE_FILL_LAYER_ID = "om-coverage-fill";
export const COVERAGE_LINE_LAYER_ID = "om-coverage-line";

/** The map's info blue, legible over both basemaps. */
const ACCENT = "#1a73e8";

/**
 * Show or clear the coverage boxes. Passing `null` removes the overlay
 * entirely; a collection (even empty) shows it. Idempotent, so it is safe to
 * call on every change and after a style load.
 */
export function syncCoverage(
  map: MapLibreMap,
  fc: CoverageFeatureCollection | null,
): void {
  if (!fc) {
    if (map.getLayer(COVERAGE_LINE_LAYER_ID)) map.removeLayer(COVERAGE_LINE_LAYER_ID);
    if (map.getLayer(COVERAGE_FILL_LAYER_ID)) map.removeLayer(COVERAGE_FILL_LAYER_ID);
    if (map.getSource(COVERAGE_SOURCE_ID)) map.removeSource(COVERAGE_SOURCE_ID);
    return;
  }

  const data = fc as unknown as GeoJSON.FeatureCollection;
  const existing = map.getSource(COVERAGE_SOURCE_ID);
  if (existing && existing.type === "geojson") {
    (existing as GeoJSONSource).setData(data);
  } else if (!existing) {
    map.addSource(COVERAGE_SOURCE_ID, { type: "geojson", data });
  }

  if (!map.getLayer(COVERAGE_FILL_LAYER_ID)) {
    map.addLayer({
      id: COVERAGE_FILL_LAYER_ID,
      type: "fill",
      source: COVERAGE_SOURCE_ID,
      paint: {
        "fill-color": ACCENT,
        "fill-opacity": 0.08,
      },
    });
  }

  if (!map.getLayer(COVERAGE_LINE_LAYER_ID)) {
    map.addLayer({
      id: COVERAGE_LINE_LAYER_ID,
      type: "line",
      source: COVERAGE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ACCENT,
        "line-width": 1.5,
        "line-opacity": 0.85,
        // Dashed, so a coverage extent never reads as a data boundary.
        "line-dasharray": [3, 2],
      },
    });
  }
}
