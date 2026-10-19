/**
 * Build vector-tile (PMTiles) bundles for the heaviest GeoJSON layers.
 *
 * GeoJSON layers stay in public/data and remain the fallback; this adds a
 * `tiles/<id>.pmtiles` archive alongside the ones listed below, which the map
 * prefers when present (see src/lib/map-layers.ts). Tiling the top few layers
 * cuts the initial parse/transfer cost of the biggest files without touching
 * the rest of the registry.
 *
 * Usage:
 *   node scripts/build-tiles.mjs            # default heavy set
 *   TILE_LAYERS=roads node scripts/build-tiles.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import geojsonvt from "geojson-vt";
import { fromGeojsonVt } from "vt-pbf";
import { zxyToTileId } from "pmtiles";
import { buildPmtiles } from "./lib/pmtiles-writer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");
const OUT = path.join(ROOT, "public", "tiles");

const DEFAULT_LAYERS = ["roads", "footpaths", "overture-places", "house-numbers", "power-lines", "buildings", "marine-habitats"];
const layersArg = process.env.TILE_LAYERS;
const LAYERS_TO_TILE = layersArg ? layersArg.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_LAYERS;

const MAX_ZOOM = Number(process.env.TILE_MAX_ZOOM ?? 14);
const ZOOM_OVERRIDES = {
  roads: 16,
  footpaths: 16,
};
// Buildings only make sense once the viewer is zoomed in; tiling them from z8
// would ship a thicket of low-zoom tiles the map never asks for.
const MIN_ZOOM_OVERRIDES = {
  buildings: 12,
};
const MIN_ZOOM_OVERRIDE = process.env.TILE_MIN_ZOOM ? Number(process.env.TILE_MIN_ZOOM) : null;

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, "manifest.json"), "utf8"));

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

fs.mkdirSync(OUT, { recursive: true });

let totalBytes = 0;
const rows = [];

for (const id of LAYERS_TO_TILE) {
  const info = manifest.layers?.[id];
  if (!info || !info.file) {
    console.warn(`  skip ${id}: not in manifest`);
    continue;
  }
  const file = path.join(DATA, info.file);
  if (!fs.existsSync(file)) {
    console.warn(`  skip ${id}: ${info.file} missing`);
    continue;
  }

  const geojson = JSON.parse(fs.readFileSync(file, "utf8"));
  const [minLon, minLat, maxLon, maxLat] = info.bbox ?? [-4.9, 54.0, -4.2, 54.45];
  const minZoom = MIN_ZOOM_OVERRIDE ?? MIN_ZOOM_OVERRIDES[id] ?? Math.max(0, Math.min(12, info.minZoom ?? 8));

  const layerMaxZoom = ZOOM_OVERRIDES[id] ?? MAX_ZOOM;
  const index = new geojsonvt(geojson, {
    maxZoom: layerMaxZoom,
    indexMaxZoom: layerMaxZoom,
    tolerance: 0.375,
    extent: 4096,
    buffer: 64,
  });

  const tiles = [];
  for (let z = minZoom; z <= layerMaxZoom; z++) {
    const x0 = lon2x(minLon, z);
    const x1 = lon2x(maxLon, z);
    const y0 = lat2y(maxLat, z);
    const y1 = lat2y(minLat, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const tile = index.getTile(z, x, y);
        if (!tile || tile.features.length === 0) continue;
        const data = fromGeojsonVt({ [id]: tile });
        tiles.push({ tileId: zxyToTileId(z, x, y), z, x, y, data });
      }
    }
  }

  if (tiles.length === 0) {
    console.warn(`  skip ${id}: no tiles produced`);
    continue;
  }

  const metadata = {
    name: id,
    format: "pbf",
    vector_layers: [{ id, fields: {} }],
  };
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const archive = buildPmtiles({
    tiles,
    metadata,
    minZoom,
    maxZoom: layerMaxZoom,
    bounds: [minLon, minLat, maxLon, maxLat],
    center: [centerLon, centerLat, Math.min(layerMaxZoom, Math.round((minZoom + layerMaxZoom) / 2))],
  });

  const outFile = path.join(OUT, `${id}.pmtiles`);
  fs.writeFileSync(outFile, archive);
  totalBytes += archive.length;
  rows.push({ id, tiles: tiles.length, bytes: archive.length, sourceBytes: info.bytes ?? fs.statSync(file).size });
  console.log(
    `  ${id.padEnd(18)} tiles=${String(tiles.length).padStart(5)}  pmtiles=${(archive.length / 1024).toFixed(1)} KiB  (from ${((info.bytes ?? 0) / 1024).toFixed(0)} KiB geojson)`,
  );
}

console.log(`\nOpenMannin tile build`);
console.log(`  layers   ${rows.length}`);
console.log(`  total    ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
fs.writeFileSync(
  path.join(OUT, "index.json"),
  JSON.stringify({ generated: manifest.generated ?? null, layers: rows }, null, 2) + "\n",
);
