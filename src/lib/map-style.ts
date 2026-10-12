/**
 * Basemap definitions and style creation.
 *
 * OpenTopoMap: raster hill-shaded tiles, keyless, CORS-open, CC-BY-SA.
 * The OpenStreetMap DATABASE (ODbL) underpins the data.
 */

import type { StyleSpecification, Map as MapLibreMap } from "maplibre-gl";

export type BasemapId = "opentopo";

export const BASEMAPS: Record<BasemapId, BasemapDef> = {
  "opentopo": {
    kind: "raster",
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    attribution:
      "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap (CC-BY-SA)",
    maxzoom: 17,
  },
};

export type BasemapDef =
  | { kind: "raster"; tiles: string[]; attribution: string; maxzoom: number }
  | { kind: "style"; styleUrl: string; attribution: string; maxzoom: number };

const GLYPHS = "https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf";

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
export const TERRAIN_ATTRIBUTION =
  "Elevation: Copernicus EU-DEM &amp; SRTM (USGS) via AWS Open Data terrain tiles";

/**
 * Switch 3D terrain on or off, and tilt the camera to match.
 *
 * The DEM source is added at runtime rather than baked into createInitialStyle
 * because the OpenFreeMap basemaps swap the whole style on every change: a
 * source declared in the style would be dropped and the terrain silently
 * un-set. Re-adding it after every style.load keeps a style swap from quietly
 * flattening the map under a checkbox that still says "3D on".
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

/**
 * OpenSeaMap seamark overlay.
 *
 * A keyless, CORS-open raster overlay of nautical marks — buoys, beacons,
 * lights, harbour detail — rendered by the OpenSeaMap project. Underneath it is
 * the same OpenStreetMap database (ODbL); the RENDERED TILES are CC-BY-SA 2.0.
 * It is a display overlay only: OSM seamark characteristics are frequently
 * absent or wrong and this is not a navigation chart.
 */
export const SEAMARK_SOURCE_ID = "seamark-overlay";
export const SEAMARK_LAYER_ID = "seamark-overlay";
export const SEAMARK_TILES = ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"];
export const SEAMARK_ATTRIBUTION =
  '&copy; <a href="https://www.openseamap.org/">OpenSeaMap</a> contributors (CC-BY-SA 2.0)';

/**
 * Add or remove the OpenSeaMap overlay.
 *
 * The source is REPLACED (not retargeted) on each style swap, exactly like the
 * basemap, because a style swap drops every runtime source. The layer is kept
 * above the basemap but below every data layer, so the marks read as a chart
 * backdrop and never hide the `om-*` layers drawn over them.
 */
export function applySeamarkOverlay(map: MapLibreMap, on: boolean): void {
  if (!on) {
    if (map.getLayer(SEAMARK_LAYER_ID)) map.removeLayer(SEAMARK_LAYER_ID);
    if (map.getSource(SEAMARK_SOURCE_ID)) map.removeSource(SEAMARK_SOURCE_ID);
    return;
  }

  if (!map.getSource(SEAMARK_SOURCE_ID)) {
    map.addSource(SEAMARK_SOURCE_ID, {
      type: "raster",
      tiles: SEAMARK_TILES,
      tileSize: 256,
      attribution: SEAMARK_ATTRIBUTION,
    });
  }
  if (map.getLayer(SEAMARK_LAYER_ID)) return;

  // Insert before the first data layer when there is one, otherwise append:
  // never before `background`, which is opaque and would cover the overlay.
  const firstDataLayer = map.getStyle().layers?.find((l) => l.id.startsWith("om-"))?.id;
  map.addLayer(
    { id: SEAMARK_LAYER_ID, type: "raster", source: SEAMARK_SOURCE_ID },
    firstDataLayer,
  );
}

/** Centre on the Isle of Man, framed so the whole island is visible at z10. */
export const INITIAL_CENTRE: [number, number] = [-4.4814, 54.1509];
export const INITIAL_ZOOM = 10;

export function createInitialStyle(bm: BasemapDef): StyleSpecification | string {
  if (bm.kind === "style") {
    return bm.styleUrl;
  }
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      basemap: {
        type: "raster",
        tiles: bm.tiles,
        tileSize: 256,
        attribution: bm.attribution,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#0b0f14" } },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}

export function applyRasterBasemap(map: MapLibreMap, bm: Extract<BasemapDef, { kind: "raster" }>): void {
  // Raster basemap: replace the basemap source/layer in-place.
  // The raster source has to be REPLACED, not retargeted. Attribution in
  // MapLibre is a property of the source in the style, and setTiles() keeps
  // the original attribution - so switching basemaps that way leaves the
  // control crediting the old provider while different tiles are on screen.
  // That is a licence-compliance bug, not a cosmetic one.
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");

  map.addSource("basemap", {
    type: "raster",
    tiles: bm.tiles,
    tileSize: 256,
    attribution: bm.attribution,
  });

  // The basemap MUST be re-inserted at the bottom of the layer stack.
  // addLayer without a beforeId appends to the end, which would drop an
  // opaque raster layer on top of every data layer and make the whole map
  // look empty.
  const firstDataLayer = map
    .getStyle()
    .layers?.find((l) => l.id.startsWith("om-"))?.id;
  map.addLayer(
    { id: "basemap", type: "raster", source: "basemap" },
    firstDataLayer ?? (map.getLayer("background") ? "background" : undefined),
  );
}