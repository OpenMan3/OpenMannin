/**
 * Basemap definition and style creation.
 *
 * OpenFreeMap Liberty: keyless, CORS-open vector basemap on ODbL OpenStreetMap
 * data. Chosen from a five-style evaluation set (Liberty, bright, positron,
 * fiord, dark) for legibility; the others were stripped out. One host serves
 * the style JSON, vector tiles, sprites and glyphs.
 *
 * The OpenStreetMap DATABASE (ODbL) underpins it.
 */

import type { Map as MapLibreMap } from "maplibre-gl";

export type BasemapId = "liberty";

const OPENFREEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors (ODbL) | Basemap <a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a> | Style &copy; <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a>';

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  "liberty": {
    kind: "style",
    styleUrl: "https://tiles.openfreemap.org/styles/liberty",
    attribution: OPENFREEMAP_ATTRIBUTION,
    maxzoom: 17,
  },
};

export type BasemapDef = {
  kind: "style";
  styleUrl: string;
  attribution: string;
  maxzoom: number;
};

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

export function createInitialStyle(bm: BasemapDef): string {
  return bm.styleUrl;
}