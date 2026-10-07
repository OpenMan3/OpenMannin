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

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres between two lon/lat pairs. */
function haversineKm(aLon, aLat, bLon, bLat) {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
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
    const d = haversineKm(lon, lat, p.lon, p.lat);
    if (d < bestKm) {
      bestKm = d;
      best = p;
    }
  }
  if (!best || bestKm > MAX_KM) return null;
  return { place: best.label, metres: Math.round(bestKm * 1000) };
}

function annotate() {
  const geo = LAYERS.filter((l) => l.kind === "geojson" && l.file && l.id !== "toponyms");
  const places = buildToponyms(
    LAYERS.find((l) => l.id === "toponyms")?.file ?? "toponyms.geojson",
  );
  if (places.length === 0) {
    throw new Error("no toponyms found");
  }

  let total = 0;
  let untouched = 0;
  const changes = {};

  for (const layer of geo) {
    const file = path.join(DATA, layer.file);
    if (!fs.existsSync(file)) continue;
    const fc = JSON.parse(fs.readFileSync(file, "utf8"));
    let layerHits = 0;

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
      if (!hit) continue;
      props.nearestPlace = hit.place;
      props.nearestPlaceDistanceM = hit.metres;
      layerHits++;
    }

    if (layerHits > 0) {
      // Keep bytes identical when nothing on a whole layer changed.
      fs.writeFileSync(file, JSON.stringify(fc, null, 0) + "\n");
      total += layerHits;
      changes[layer.id] = layerHits;
    }
  }

  const summary = Object.entries(changes)
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id}: ${n}`)
    .join(", ");
  console.log(
    `annotate-nearest-place: ${total} anonymous features got a nearest place (${Object.keys(changes).length} layers), ${untouched} already identified`,
  );
  console.log(`  ${summary || "no changes"}`);
}

annotate();