/**
 * Annotate anonymous features with their nearest place.
 *
 * A named feature carries its own identity, but a nameless footway, stream or
 * speed sign has nothing to call itself. The label resolver renders those as
 * "Footway near Noble's Park". This script writes that "near"-part at
 * build time: for every feature with no identity (name/ref/code/...), it finds
 * the closest of the 1,253 named places in toponyms.geojson and records
 * `nearestPlace` plus `nearestPlaceDistanceM`, capped at a distance where
 * "near" would start to lie.
 *
 * Mutates the shipped public/data feature files in place and is idempotent.
 * FeatureCollection properties blocks (provenance, licence) are left untouched,
 * and features that already have an identity are never touched. Reads committed
 * data only - no network.
 *
 *   node --experimental-strip-types --no-warnings scripts/annotate-nearest-place.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LAYERS } from "../src/lib/layers.ts";
import { featureCentre } from "../src/lib/feature-index.ts";
import { hasIdentity } from "../src/lib/feature-label.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "public", "data");

/** Farthest distance at which we still call a place "nearest". */
const MAX_KM = 5;
/** Farthest distance at which a building is still treated as "on" a road. */
const MAX_ROAD_M = 100;
const ROADS = "roads.geojson";

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres between two lon/lat pairs. */
function haversineM(aLon, aLat, bLon, bLat) {
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Shortest distance in metres from point P to line segment AB (local metres). */
function pointToSegmentM(px, py, ax, ay, bx, by) {
  const mPerLat = 111132;
  const mPerLon = 111132 * Math.cos(toRad(py));
  const axM = ax * mPerLon;
  const ayM = ay * mPerLat;
  const bxM = bx * mPerLon;
  const byM = by * mPerLat;
  const pxM = px * mPerLon;
  const pyM = py * mPerLat;
  const abx = bxM - axM;
  const aby = byM - ayM;
  const apx = pxM - axM;
  const apy = pyM - ayM;
  const abLen2 = abx * abx + aby * aby;
  if (abLen2 === 0) return Math.hypot(pxM - axM, pyM - ayM);
  let t = (apx * abx + apy * aby) / abLen2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = axM + t * abx;
  const cy = ayM + t * aby;
  return Math.hypot(pxM - cx, pyM - cy);
}

function buildToponyms(file) {
  const fc = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  const out = [];
  for (const f of fc.features ?? []) {
    if (!f.properties?.name) continue;
    const centre = featureCentre(f.geometry);
    if (!centre) continue;
    out.push({ label: f.properties.name, lon: centre[0], lat: centre[1] });
  }
  return out;
}

function nearest(places, lon, lat) {
  let best = null;
  let bestKm = Infinity;
  for (const p of places) {
    const d = haversineM(lon, lat, p.lon, p.lat) / 1000;
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  if (!best || bestKm > MAX_KM) return null;
  return { place: best.label, metres: Math.round(bestKm * 1000) };
}

/** Flatten named road geometries into grid-indexed segments
 *  [lon1, lat1, lon2, lat2, name]. Indexing by segment midpoint so a search
 *  around a building finds every segment whose closest point could be near it.
 *
 *  Handles LineString/MultiLineString (flat rings) and Polygon/MultiPolygon
 *  (nested rings). Consecutive points within a ring form a segment; the last
 *  point of a closed ring pairs back with the first. */
function buildRoads(file) {
  const fc = JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  const out = [];
  for (const f of fc.features ?? []) {
    const name = f.properties?.name;
    if (!name) continue;
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    // A ring is a flat array of [lon, lat] points. Emit consecutive pairs as
    // segments, wrapping the last point back to the first for closed rings.
    const emitRing = (ring) => {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        out.push([a[0], a[1], b[0], b[1], name]);
      }
    };
    const walk = (c) => {
      if (typeof c[0] === "number") {
        // c is a flat [lon, lat] point — not a ring, skip (Point geometries)
        return;
      }
      if (typeof c[0][0] === "number") {
        // c is a ring: flat array of [lon, lat] points
        emitRing(c);
      } else {
        // c is [ring, ring, ...] (Polygon or MultiLineString/MultiPolygon)
        for (const inner of c) walk(inner);
      }
    };
    walk(coords);
  }
  return out;
}

function roadGrid(segments) {
  const CELL = 0.0005;
  const grid = new Map();
  const key = (lon, lat) => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;
  for (const [aLon, aLat, bLon, bLat, name] of segments) {
    const midLon = (aLon + bLon) / 2;
    const midLat = (aLat + bLat) / 2;
    const k = key(midLon, midLat);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ aLon, aLat, bLon, bLat, name });
  }
  return { grid, CELL, key };
}

function nearestRoad({ grid, CELL, key }, lon, lat) {
  let bestM = Infinity;
  let secondM = Infinity;
  let best = null;
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const cell = grid.get(`${cx + dx}:${cy + dy}`);
      if (!cell) continue;
      for (const s of cell) {
        const d = pointToSegmentM(lon, lat, s.aLon, s.aLat, s.bLon, s.bLat);
        if (d < bestM) {
          secondM = bestM;
          bestM = d;
          best = s;
        } else if (d < secondM) {
          secondM = d;
        }
      }
    }
  }
  if (!best || bestM > MAX_ROAD_M) return null;
  return { road: best.name, metres: Math.round(bestM), secondMetres: Math.round(secondM) };
}

function annotate() {
  const geo = LAYERS.filter((l) => l.kind === "geojson" && l.file && l.id !== "toponyms");
  const places = buildToponyms(
    LAYERS.find((l) => l.id === "toponyms")?.file ?? "toponyms.geojson",
  );
  if (places.length === 0) {
    throw new Error("no toponyms found");
  }
  const roads = buildRoads(ROADS);
  const roadIndex = roadGrid(roads);

  let total = 0;
  let untouched = 0;
  const changes = {};

  for (const layer of geo) {
    const file = path.join(DATA, layer.file);
    if (!fs.existsSync(file)) continue;
    const fc = JSON.parse(fs.readFileSync(file, "utf8"));
    let layerHits = 0;
    let roadHits = 0;

    for (const f of fc.features ?? []) {
      const props = f.properties ?? {};
      // Keep the geometry in the same object tree: annotate in place.
      if (hasIdentity(props)) {
        untouched++;
        continue;
      }
      const centre = featureCentre(f.geometry);
      if (!centre) continue;
      const hit = nearest(places, centre[0], centre[1]);
      if (hit) {
        props.nearestPlace = hit.place;
        props.nearestPlaceDistanceM = hit.metres;
        layerHits++;
      }

      // Buildings get their nearest named road too, so an unaddressed footprint
      // reads "Building on Tennis Road" rather than "Footprint near <distant settlement>".
      // A margin check avoids wrong labels at junctions: only label when the
      // building is clearly on one road (within 3 m) or there is a clear gap
      // (>= 2 m) to the next-closest road.
      if (layer.id === "buildings") {
        const roadHit = nearestRoad(roadIndex, centre[0], centre[1]);
        const gap = roadHit ? roadHit.secondMetres - roadHit.metres : 0;
        const confident = roadHit && (roadHit.metres <= 3 || gap >= 2);
        if (confident) {
          props.nearestRoad = roadHit.road;
          props.nearestRoadDistanceM = roadHit.metres;
          roadHits++;
        } else {
          delete props.nearestRoad;
          delete props.nearestRoadDistanceM;
        }
      }
    }

    if (layerHits > 0 || roadHits > 0) {
      // Keep bytes identical when nothing on a whole layer changed.
      fs.writeFileSync(file, JSON.stringify(fc, null, 0) + "\n");
      total += layerHits + roadHits;
      changes[layer.id] = layerHits + roadHits;
    }
  }

  const summary = Object.entries(changes)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id}: ${n}`)
    .join(", ");
  console.log(
    `annotate-nearest-place: ${total} anonymous features annotated (${Object.keys(changes).length} layers), ${untouched} already identified`,
  );
  console.log(`  ${summary || "no changes"}`);
}

annotate();