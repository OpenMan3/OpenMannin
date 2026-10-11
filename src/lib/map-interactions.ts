/**
 * Map interaction handlers.
 *
 * Handles click, mousemove, fly-to, and highlight events. These are
 * separated from the main MapView component to keep it focused on
 * the map lifecycle.
 */

import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { LayerDef, Feature } from "@/lib/types";
import { layerByMapLayerId } from "./map-layers";
import { highlightFeature, clearHighlight } from "./map-live";

const WORKER_BASE = "/";

/**
 * Attach all interaction handlers to the map.
 */
export function attachMapInteractions(
  map: MapLibreMap,
  layersRef: { current: LayerDef[] },
  onPickRef: { current: (picked: { layer: LayerDef; properties: Record<string, unknown> | null; lon: number; lat: number; asOf?: string } | null) => void },
  onViewportRef: { current: ((v: { lon: number; lat: number; zoom: number }) => void) | undefined },
  suppressClickUntilRef: { current: number },
  layerAsOfRef: { current: Map<string, string> },
): () => void {
  // Click handler
  const handleClick = (e: MapMouseEvent) => {
    // A long-press that dropped a destination also emits a synthetic click
    // (or a real one if the finger lingered). Swallow it so the pin drop
    // does not immediately clear the feature popup.
    if (Date.now() < suppressClickUntilRef.current) return;

    const hits = map.queryRenderedFeatures(e.point);
    for (const hit of hits) {
      const layer = layerByMapLayerId(hit.layer.id, layersRef.current);
      if (!layer) continue;
      onPickRef.current({
        layer,
        properties: hit.properties ?? null,
        lon: e.lngLat.lng,
        lat: e.lngLat.lat,
        asOf: layerAsOfRef.current.get(layer.id),
      });
      return;
    }
    onPickRef.current(null);
  };

  // Mousemove handler (throttled)
  let cursorFrame = 0;
  const handleMouseMove = (e: MapMouseEvent) => {
    if (cursorFrame) return;
    cursorFrame = requestAnimationFrame(() => {
      cursorFrame = 0;
      if (map !== map) return; // defensive
      const hits = map.queryRenderedFeatures(e.point);
      const ours = hits.some(
        (h) => layerByMapLayerId(h.layer.id, layersRef.current) !== undefined,
      );
      map.getCanvas().style.cursor = ours ? "pointer" : "";
    });
  };

  // Viewport change handler
  const handleMoveEnd = () => {
    const c = map.getCenter();
    onViewportRef.current?.({
      lon: c.lng,
      lat: c.lat,
      zoom: map.getZoom(),
    });
  };

  // Fly-to handler (window event)
  const handleFlyTo = (e: Event) => {
    const { lon, lat, zoom } = (e as CustomEvent).detail as { lon: number; lat: number; zoom?: number };
    map.flyTo({
      center: [lon, lat],
      zoom: zoom ?? Math.max(map.getZoom(), 14),
      duration: 700,
    });
  };

  // Fit-to-layer handler (window event). Used by the layer detail drawer's
  // "Zoom to layer" button: the drawer knows the layer's bbox from the manifest,
  // the map owns the camera.
  const handleFitLayer = (e: Event) => {
    const { bbox } = (e as CustomEvent).detail as {
      bbox: [number, number, number, number];
    };
    if (!Array.isArray(bbox) || bbox.length !== 4) return;
    const [minX, minY, maxX, maxY] = bbox;
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 48, duration: 700, maxZoom: 16 },
    );
  };

  // Highlight handler (window event)
  const handleHighlight = async (e: Event) => {
    const { feature } = (e as CustomEvent).detail as {
      layerId: string;
      feature: Feature,
    };
    if (!feature.geometry) return;
    highlightFeature(map, feature.geometry);
  };

  // Clear highlight handler (window event)
  const handleClearHighlight = () => {
    clearHighlight(map);
  };

  // Attach all listeners
  map.on("click", handleClick);
  map.on("mousemove", handleMouseMove);
  map.on("moveend", handleMoveEnd);
  window.addEventListener("openmannin:fly-to", handleFlyTo);
  window.addEventListener("openmannin:fit-layer", handleFitLayer);
  window.addEventListener("openmannin:highlight-feature", handleHighlight);
  window.addEventListener("openmannin:clear-highlight", handleClearHighlight);

  // Return cleanup function
  return () => {
    map.off("click", handleClick);
    map.off("mousemove", handleMouseMove);
    map.off("moveend", handleMoveEnd);
    window.removeEventListener("openmannin:fly-to", handleFlyTo);
    window.removeEventListener("openmannin:fit-layer", handleFitLayer);
    window.removeEventListener("openmannin:highlight-feature", handleHighlight);
    window.removeEventListener("openmannin:clear-highlight", handleClearHighlight);
  };
}

/**
 * Set up the WebGL context lost/restored handlers.
 */
export function attachWebGLHandlers(map: MapLibreMap): () => void {
  const handleContextLost = () => {
    console.warn("[map] WebGL context lost; waiting for restore");
  };

  const handleContextRestored = () => {
    map.resize();
    map.triggerRepaint();
  };

  map.on("webglcontextlost", handleContextLost);
  map.on("webglcontextrestored", handleContextRestored);

  return () => {
    map.off("webglcontextlost", handleContextLost);
    map.off("webglcontextrestored", handleContextRestored);
  };
}

/**
 * Set up the MapLibre worker URL.
 */
export async function setMapLibreWorkerUrl(): Promise<void> {
  const maplibregl = await import("maplibre-gl");
  maplibregl.setWorkerUrl(`${WORKER_BASE}maplibre-gl-worker.mjs`);
}