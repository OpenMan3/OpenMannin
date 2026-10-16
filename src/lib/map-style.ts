/**
 * Basemap definition and style creation.
 *
 * OpenFreeMap Liberty: keyless, CORS-open vector basemap on ODbL OpenStreetMap
 * data. Chosen from a five-style evaluation set (Liberty, bright, positron,
 * fiord, dark) for legibility; one host serves the style JSON, vector tiles,
 * sprites and glyphs. The evaluation surfaced the "dark" style too, so the app
 * ships two of the five: Liberty by day, OpenFreeMap "dark" at night, selected
 * by the same resolved theme that darkens the chrome.
 *
 * The OpenStreetMap DATABASE (ODbL) underpins it.
 *
 * Runtime swaps: a theme change while the map is live must go through
 * `map.setStyle(url, { diff: false })` — a straight setStyle without that hint
 * can diff two unrelated styles. A style swap drops every source and layer we
 * added, so the caller must let the existing `style.load` handler in MapView
 * re-run its resync (static layers, cached feeds, terrain, nav markers) before
 * the map looks right again.
 */

import type { Map as MapLibreMap } from "maplibre-gl";
import { DARK_STYLE_URL, LIGHT_STYLE_URL } from "./theme";

/**
 * Kept for callers that only need the light style URL (e.g. WebGL tile-error
 * attribution). Prefer `styleUrlForDark` / `createInitialStyle` for anything
 * theme-aware.
 */
export const LIBERTY_STYLE_URL = LIGHT_STYLE_URL;
export const LIBERTY_MAXZOOM = 17;

/**
 * 3D terrain: a keyless, CORS-open DEM.
 *
 * AWS Open Data "Terrain Tiles" (Mapzen/Joerd) on S3, terrarium encoding,
 * maxzoom 15. Over the Isle of Man the contributing layers are Copernicus
 * EU-DEM and SRTM (public domain). No API key and no per-host rate limit to
 * negotiate, which is why this is the only DEM the app will touch.
 */
export const TERRAIN_SOURCE_ID = "terrain-rgb";
export const TERRAIN_TILES = [
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
];
export const TERRAIN_ATTRIBUTION = "";

/**
 * Switch 3D terrain on or off, and tilt the camera to match.
 *
 * The DEM source is added at runtime rather than baked into createInitialStyle
 * because the OpenFreeMap style is loaded by URL: a source declared alongside
 * it would not survive the style load, and the terrain would silently un-set.
 * Re-adding it after every style.load keeps the map from quietly flattening
 * under a checkbox that still says "3D on".
 */
export function applyTerrain(map: MapLibreMap, enabled: boolean): void {
  if (enabled) {
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
      map.addSource(TERRAIN_SOURCE_ID, {
        type: "raster-dem",
        tiles: TERRAIN_TILES,
        tileSize: 256,
        maxzoom: 15,
        encoding: "terrarium",
        attribution: TERRAIN_ATTRIBUTION,
      });
    }
    map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
    map.easeTo({ pitch: 60, duration: 1000 });
  } else {
    // Order matters: clear the terrain before removing the source it points at.
    map.setTerrain(null);
    if (map.getSource(TERRAIN_SOURCE_ID)) map.removeSource(TERRAIN_SOURCE_ID);
    map.easeTo({ pitch: 0, duration: 1000 });
  }
}

/** Centre on the Isle of Man, framed so the whole island is visible at z10. */
export const INITIAL_CENTRE: [number, number] = [-4.4814, 54.1509];
export const INITIAL_ZOOM = 10;

/** The basemap URL for a resolved theme. */
export function styleUrlForDark(dark: boolean): string {
  return dark ? DARK_STYLE_URL : LIGHT_STYLE_URL;
}

/**
 * The basemap to open the map with. Runs client-side during map construction,
 * so it reads the `dark` class the bootstrap script already put on <html> and
 * starts on the matching basemap — no bright flash of Liberty before the night
 * style loads. On the server (or in any script without a document) it falls
 * back to Liberty.
 */
export function createInitialStyle(): string {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("dark")) {
    return DARK_STYLE_URL;
  }
  return LIGHT_STYLE_URL;
}