#!/usr/bin/env node
/**
 * update-data — the single Overpass refresh for the island-wide layers.
 *
 * WHAT IT IS
 * ----------
 * One bbox-driven OSM harvester for the subcategory layers that were missing
 * from the map (grid lines, water supply), plus a rebuild of the manifest,
 * search index and registry check. The archaeology and heritage layers now live
 * in scripts/ingest-overpass-heritage.mjs. Every query is scoped to the Isle
 * of Man bounding box and every file is stamped with provenance resolved from
 * the SAME registers the UI renders, so a data file explains its own source and
 * licence without the app.
 *
 * LICENCE POSTURE
 * ---------------
 * OpenMannin only ever renders unambiguously open data. This script therefore
 * queries OpenStreetMap (ODbL) and nothing else. There is deliberately no path
 * here to a source that requires written permission: if a layer needs
 * permission, it does not belong on an open map.
 *
 *   node --experimental-strip-types scripts/update-data.mjs
 *   node --experimental-strip-types scripts/update-data.mjs --no-build   (fetch only)
 */

import { spawnSync } from "node:child_process";
import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";
const NO_BUILD = process.argv.includes("--no-build");

/**
 * Turn an Overpass element into a GeoJSON feature.
 *
 * Mode is inferred rather than declared: a node is a point, a way is a line, and
 * a way that comes back closed is a polygon when the dataset says so. `keep`
 * maps output property -> OSM tag.
 */
function toFeature(el, { area = false, keep }, isFeature) {
  const t = el.tags ?? {};
  if (isFeature && !isFeature(t)) return null;

  const props = {};
  for (const [dest, src] of Object.entries(keep)) {
    const v = t[src];
    if (v !== undefined && v !== "") props[dest] = v;
  }
  props.osm = `${el.type}/${el.id}`;
  if (t.wikidata) props.wikidata = t.wikidata;
  if (t.wikipedia) props.wikipedia = t.wikipedia;

  let geometry = null;
  if (el.type === "node") {
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) return null;
    geometry = { type: "Point", coordinates: [lon, lat] };
  } else {
    const g = el.geometry;
    if (!g || g.length < 2) return null;
    const coords = g.map((p) => [p.lon, p.lat]);
    const closed =
      coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];
    geometry =
      area && closed
        ? { type: "Polygon", coordinates: [coords] }
        : { type: "LineString", coordinates: coords };
  }

  return {
    type: "Feature",
    id: props.osm,
    geometry: roundCoords(geometry, 6),
    properties: { id: props.osm, ...props },
  };
}

const DATASETS = [
  {
    out: "power-lines.geojson",
    label: "power lines & transformers",
    // The power layer explicitly does NOT draw routes; this is that missing
    // network: the overhead/underground lines and the transformers on them.
    query: `[out:json][timeout:180];
(
  way["power"~"^(line|minor_line)$"](${BBOX});
  node["power"~"^(tower|pole|transformer)$"](${BBOX});
);
out geom;`,
    keep: {
      power: "power",
      name: "name",
      voltage: "voltage",
      wires: "wires",
      cables: "cables",
      operator: "operator",
      ref: "ref",
    },
    isFeature: (t) => t.power && t.power !== "no",
  },
  {
    out: "water-works.geojson",
    label: "water works & pumping stations",
    query: `[out:json][timeout:180];
(
  node["man_made"~"^(water_works|water_tower|pumping_station|water_well|reservoir_covered)$"](${BBOX});
  way["man_made"~"^(water_works|water_tower|pumping_station|water_well|reservoir_covered)$"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      manMade: "man_made",
      operator: "operator",
      capacity: "capacity",
      height: "height",
      ref: "ref",
    },
    area: true,
  },
];

async function fetchDatasets() {
  console.log(`update-data — Overpass for bbox [${BBOX}] (ODbL, OpenStreetMap)`);
  const report = [];

  for (const ds of DATASETS) {
    const body = await overpass(ds.query, ds.label);
    const features = [];
    for (const el of body.elements ?? []) {
      const f = toFeature(el, ds, ds.isFeature);
      if (f) features.push(f);
    }

    const fc = { type: "FeatureCollection", name: ds.out.replace(/\.geojson$/, ""), features };
    const provenance = registryProvenance(ds.out);
    if (provenance) fc.properties = provenance;
    else
      console.warn(
        `  ! WARNING no registered layer claims ${ds.out}; provenance not stamped and verify:registry will flag it`,
      );

    writeJSON(`${OUT}/${ds.out}`, fc);
    report.push({ file: ds.out, features: features.length });
    console.log(`  ${String(features.length).padStart(6)} features  ${ds.out}`);
  }

  console.log("");
  for (const r of report) {
    if (r.features === 0) console.warn(`  ! ${r.file} is EMPTY — check the query or drop the layer`);
  }
  return report;
}

function run(label, args) {
  console.log(`\n> ${label}`);
  const res = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (res.status !== 0) {
    console.error(`\n${label} failed (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

async function main() {
  await fetchDatasets();

  if (NO_BUILD) {
    console.log("\n--no-build: skipping manifest/search/verify.");
    return;
  }

  console.log("\nRebuilding derived artefacts");
  run("build:manifest", ["--experimental-strip-types", "--no-warnings", "scripts/build-manifest.mjs"]);
  run("build:search", ["--experimental-strip-types", "--no-warnings", "scripts/build-search-index.mjs"]);
  run("build:sources", ["--experimental-strip-types", "--no-warnings", "scripts/build-sources.mjs"]);
  run("verify:registry", ["--experimental-strip-types", "--no-warnings", "scripts/verify-registry.mjs"]);
  console.log("\nupdate-data complete.");
}

main().catch((err) => {
  console.error("update-data failed:", err.message);
  process.exit(1);
});
