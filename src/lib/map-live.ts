/**
 * Live feed polling and sync.
 *
 * Live layers are polled from their source APIs and rendered as GeoJSON
 * sources. This module handles the polling lifecycle, retries with
 * exponential backoff, and re-syncing after style changes.
 */

import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { LayerDef } from "@/lib/types";
import { fetchFeed } from "@/lib/feeds";
import { nextPollDelayMs } from "@/lib/feeds/backoff";
import { addPaintLayers, PAINT_SUFFIXES } from "@/lib/map-layers";
import { geometryKindsOf, type FeatureCollection } from "@/lib/layer-data";

export type FeedErrorSetter = (id: string, message: string | null) => void;

const LIVE_REFS = new Map<string, ReturnType<typeof setTimeout>>();
const POLL_FAILURES = new Map<string, number>();
const IN_FLIGHT = new Set<string>();
const LIVE_FC_CACHE = new Map<string, FeatureCollection>();

/**
 * Schedule a single live layer's next poll.
 */
export function schedulePoll(
  id: string,
  enabledRef: { current: Set<string> },
  layersRef: { current: LayerDef[] },
  mapRef: { current: MapLibreMap | null },
  setFeedError: (id: string, message: string | null) => void,
): void {
  // Clear any existing timer
  const existing = LIVE_REFS.get(id);
  if (existing) clearTimeout(existing);

  // If the layer is no longer enabled, don't schedule
  if (!enabledRef.current.has(id)) return;

  const delay = nextPollDelayMs(POLL_FAILURES.get(id) ?? 0);
  LIVE_REFS.set(
    id,
    setTimeout(() => void poll(id, enabledRef, layersRef, mapRef, setFeedError), delay),
  );
}

/**
 * Stop polling a live layer and clean up its timer.
 * Also removes the layer's source and paint layers from the map.
 */
export function stopPoll(id: string, map?: MapLibreMap | null): void {
  const timer = LIVE_REFS.get(id);
  if (timer) clearTimeout(timer);
  LIVE_REFS.delete(id);
  POLL_FAILURES.delete(id);
  IN_FLIGHT.delete(id);
  LIVE_FC_CACHE.delete(id);

  if (map) removeLiveSource(map, id);
}

/** Drop a live layer's source and every paint layer hanging off it. */
function removeLiveSource(map: MapLibreMap, id: string): void {
  const sourceId = `om-${id}`;
  for (const suffix of PAINT_SUFFIXES) {
    const lid = `${sourceId}-${suffix}`;
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

/**
 * Poll a single live layer.
 */
async function poll(
  id: string,
  enabledRef: { current: Set<string> },
  layersRef: { current: LayerDef[] },
  mapRef: { current: MapLibreMap | null },
  setFeedError: (id: string, message: string | null) => void,
): Promise<void> {
  if (IN_FLIGHT.has(id)) return;
  if (!enabledRef.current.has(id)) return;

  IN_FLIGHT.add(id);
  const map = mapRef.current;
  if (!map) {
    IN_FLIGHT.delete(id);
    return;
  }

  const def = layersRef.current.find((d) => d.id === id);
  if (!def) {
    IN_FLIGHT.delete(id);
    return;
  }

  let healthy = false;
  try {
    const result = await fetchFeed(id);
    if (!result.ok) {
      throw new Error(result.error);
    }
    const fc = result.fc as FeatureCollection;
    healthy = true;

    // The feed may have been switched off while the request was in the air.
    // Painting anyway would leave positions on the map that the panel says are
    // hidden, with no later pass to remove them.
    if (!enabledRef.current.has(id)) return;

    const sourceId = `om-${id}`;
    const existing = map.getSource(sourceId) as GeoJSONSource | undefined;

    if (existing) {
      existing.setData(fc as never);
      LIVE_FC_CACHE.set(id, fc);
      setFeedError(id, null);
      return;
    }

    map.addSource(sourceId, { type: "geojson", data: fc as never });
    LIVE_FC_CACHE.set(id, fc);

    const kinds = geometryKindsOf(fc);
    if (kinds.size > 0) {
      const def = layersRef.current.find((d) => d.id === id);
      if (def) addPaintLayers(map, def, kinds);
    }

    setFeedError(id, null);
  } catch (e) {
    healthy = false;
    if (enabledRef.current.has(id)) {
      setFeedError(id, (e as Error).message);
    }
    console.warn(`[live] ${id} poll failed:`, (e as Error).message);
    // Don't throw - just mark unhealthy; failures shouldn't break the UI
  } finally {
    IN_FLIGHT.delete(id);

    // Retired while the request was in the air: the retire loop has
    // already cleared what it needs to, so no new timer for this layer.
    if (!enabledRef.current.has(id)) {
      // Clean up map source/layers that may have been added by this poll
      removeLiveSource(map, id);
      // eslint-disable-next-line no-unsafe-finally
      return;
    }

    POLL_FAILURES.set(
      id,
      healthy ? 0 : (POLL_FAILURES.get(id) ?? 0) + 1,
    );
    const delay = nextPollDelayMs(POLL_FAILURES.get(id) ?? 0);
    LIVE_REFS.set(id, setTimeout(() => void poll(id, enabledRef, layersRef, mapRef, setFeedError), delay));
  }
}

/**
 * Start or restart polling for all enabled live layers.
 *
 * Takes REFS rather than snapshots. A poll started here keeps running across
 * later re-renders, and it must ask the ref for the current enabled set when it
 * decides whether to paint or reschedule - otherwise a poller started before a
 * layer was switched off would read the stale set it was born with, decide the
 * layer is still wanted, and repaint it forever.
 */
export function startLivePolls(
  enabledRef: { current: Set<string> },
  layersRef: { current: LayerDef[] },
  mapRef: { current: MapLibreMap | null },
  setFeedError: FeedErrorSetter,
): void {
  const map = mapRef.current;
  if (!map) return;

  const enabled = enabledRef.current;

  // Retire pollers for layers that are no longer wanted.
  for (const [id] of LIVE_REFS) {
    if (!enabled.has(id)) stopPoll(id, map);
  }

  // Start a poller for each newly wanted live layer. schedulePoll resets its
  // own timer, so skip ids that already have one and let them keep their
  // backoff state.
  for (const id of enabled) {
    if (LIVE_REFS.has(id)) continue;
    const def = layersRef.current.find((d) => d.id === id);
    if (def?.kind === "live") {
      schedulePoll(id, enabledRef, layersRef, mapRef, setFeedError);
    }
  }
}

/**
 * Stop all live polls.
 */
export function stopAllLivePolls(map?: MapLibreMap | null): void {
  for (const [id] of LIVE_REFS) {
    stopPoll(id, map);
  }
}

/**
 * Re-sync live layers after a style change.
 */
export async function resyncLiveLayers(
  map: MapLibreMap,
  layers: LayerDef[],
  enabled: Set<string>,
): Promise<void> {
  for (const [id, fc] of LIVE_FC_CACHE) {
    const def = layers.find((d) => d.id === id);
    if (!def || !enabled.has(id)) continue;

    const sourceId = `om-${id}`;
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, { type: "geojson", data: fc as never });
      const kinds = geometryKindsOf(fc);
      if (kinds.size > 0) addPaintLayers(map, def, kinds);
    }
  }
}

/**
 * Highlight a feature on the map (used for search results).
 */
import type { Feature } from "@/lib/layer-data";

export function highlightFeature(
  map: MapLibreMap,
  geometry: Feature["geometry"] | null | undefined,
): void {
  if (!geometry) return;
  const id = "__highlight";
  const fc = {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  };

  if (map.getSource(id)) {
    (map.getSource(id) as GeoJSONSource).setData(fc as never);
    return;
  }

  map.addSource(id, { type: "geojson", data: fc as never });

  const isPoint = geometry.type === "Point" || geometry.type === "MultiPoint";
  if (isPoint) {
    map.addLayer({
      id,
      type: "circle",
      source: id,
      paint: {
        "circle-radius": 10,
        "circle-color": "#fbbf24",
        "circle-opacity": 0.95,
        "circle-stroke-color": "#0b0f14",
        "circle-stroke-width": 2,
      },
    });
  } else {
    map.addLayer({
      id,
      type: "fill",
      source: id,
      paint: {
        "fill-color": "#fbbf24",
        "fill-opacity": 0.35,
        "fill-outline-color": "#fbbf24",
      },
    });
  }
}

/**
 * Remove the highlight feature.
 */
export function clearHighlight(map: MapLibreMap): void {
  const id = "__highlight";
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}