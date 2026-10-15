/**
 * Fill missing building addresses from OpenStreetMap address nodes.
 *
 * Called after `ingest:buildings`; does NOT contact any network.
 *
 * History matters here. This script used to also copy names from nearby
 * Overture Places within 15 m. That is not verifiable: an Overture POI can be
 * misplaced, and a single wrong coordinate ("Snaefell Mountain" recorded on
 * Woodbourne Road in Douglas) silently renamed real buildings. Names now come
 * only from a building's own OpenStreetMap tags, merged by OSM element id in
 * ingest-buildings.mjs. What remains here is address fill, and it uses strict
 * point-in-polygon containment of OSM address nodes rather than a distance
 * guess: an address is attached only when the node actually sits inside the
 * footprint. A footprint containing more than one distinct address (flats,
 * terraces sharing an outline) is left blank rather than guessed at.
 *
 *   node --experimental-strip-types --no-warnings scripts/enrich-buildings-addresses.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");
const BUILDINGS = path.join(DATA, "buildings.geojson");

function readFC(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function pointCoord(geom) {
  if (geom?.type === "Point" && Array.isArray(geom.coordinates)) return geom.coordinates;
  return null;
}

/** Ray-casting point-in-ring, even-odd. `ring` is an array of [lon, lat]. */
function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const straddles = (yi > pt[1]) !== (yj > pt[1]);
    if (straddles && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A polygon is [outerRing, ...holeRings]. */
function pointInPolygon(pt, polygon) {
  if (!polygon?.length || !pointInRing(pt, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) {
    if (pointInRing(pt, polygon[k])) return false;
  }
  return true;
}

function pointInGeometry(pt, geom) {
  if (geom?.type === "Polygon") return pointInPolygon(pt, geom.coordinates);
  if (geom?.type === "MultiPolygon") return geom.coordinates.some((poly) => pointInPolygon(pt, poly));
  return false;
}

function geomBbox(geom) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === "number") {
      minLon = Math.min(minLon, c[0]); maxLon = Math.max(maxLon, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
      return;
    }
    for (const inner of c) visit(inner);
  };
  if (geom?.coordinates) visit(geom.coordinates);
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}

const buildings = readFC(BUILDINGS);
if (!buildings) {
  console.error("enrich-buildings-addresses: buildings.geojson missing");
  process.exit(1);
}
const numbers = readFC(path.join(DATA, "house-numbers.geojson"));

const CELL = 0.002; // ~150 m at IoM latitude
const grid = new Map();
const keyOf = (lon, lat) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

for (const f of numbers?.features ?? []) {
  const p = f.properties;
  if (!p || (!p.housenumber && !p.housename)) continue;
  const c = pointCoord(f.geometry);
  if (!c) continue;
  const k = keyOf(c[0], c[1]);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push({ lon: c[0], lat: c[1], p });
}

let filled = 0;
let ambiguous = 0;
for (const b of buildings.features) {
  const props = b.properties;
  if (!props || props.housenumber || props.housename) continue;
  const bbox = geomBbox(b.geometry);
  if (!bbox) continue;

  const x0 = Math.floor(bbox[0] / CELL), x1 = Math.floor(bbox[2] / CELL);
  const y0 = Math.floor(bbox[1] / CELL), y1 = Math.floor(bbox[3] / CELL);
  const found = new Map();
  for (let gx = x0; gx <= x1; gx++) {
    for (let gy = y0; gy <= y1; gy++) {
      const cell = grid.get(`${gx}:${gy}`);
      if (!cell) continue;
      for (const node of cell) {
        if (!pointInGeometry([node.lon, node.lat], b.geometry)) continue;
        const p = node.p;
        const id = `${p.housename ?? ""}|${p.housenumber ?? ""}|${p.street ?? ""}|${p.postcode ?? ""}`;
        if (!found.has(id)) found.set(id, p);
      }
    }
  }

  if (found.size === 0) continue;
  if (found.size > 1) { ambiguous++; continue; }

  const p = [...found.values()][0];
  if (p.housename) props.housename = p.housename;
  if (p.housenumber) props.housenumber = p.housenumber;
  if (p.street) props.street = p.street;
  if (p.suburb) props.suburb = p.suburb;
  if (p.city) props.city = p.city;
  if (p.postcode) props.postcode = p.postcode;
  props.addressSource = "osm-address-node";
  filled++;
}

fs.writeFileSync(BUILDINGS, JSON.stringify(buildings, null, 0) + "\n");
console.log(`enrich-buildings-addresses: addressed ${filled}, ambiguous (left blank) ${ambiguous}, of ${buildings.features.length}`);
