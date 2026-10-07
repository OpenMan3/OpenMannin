#!/usr/bin/env node
/**
 * OpenStreetMap infrastructure ingest — island-wide road, rail, bridge, water
 * and protected-area coverage.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Government map data is not open: the IoM Open Government Licence explicitly
 * excludes maps and map-derived products, and the base cartography is a
 * commercial product. OpenMannin therefore builds its island-wide vector
 * coverage from OpenStreetMap under the Open Database License (ODbL) instead.
 *
 * Every output file carries a provenance block resolved from the same registers
 * the UI renders, so the file explains its own source and licence without the
 * app.
 *
 *   node --experimental-strip-types scripts/ingest-osm-infra.mjs
 */

import { writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";

/**
 * Convert an Overpass element to a GeoJSON feature.
 * `mode` is "line" | "area" | "point".
 */
function toFeature(el, mode, keep) {
  const t = el.tags ?? {};
  const props = {};
  for (const [dest, src] of Object.entries(keep)) {
    const v = t[src];
    if (v !== undefined && v !== "") props[dest] = v;
  }
  props.osm = `${el.type}/${el.id}`;
  if (t.wikidata) props.wikidata = t.wikidata;

  let geometry = null;
  if (mode === "point") {
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
    if (mode === "area" && closed) {
      geometry = { type: "Polygon", coordinates: [coords] };
    } else {
      geometry = { type: "LineString", coordinates: coords };
    }
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
    out: "roads.geojson",
    label: "road network",
    mode: "line",
    query: `[out:json][timeout:180];
way["highway"](${BBOX});
out geom;`,
    keep: { name: "name", highway: "highway", ref: "ref", surface: "surface" },
    isFeature: (t) => t.highway && !["proposed", "construction", "razed"].includes(t.highway),
  },
  {
    out: "railways.geojson",
    label: "railways",
    mode: "line",
    query: `[out:json][timeout:180];
way["railway"~"^(rail|light_rail|narrow_gauge|tram|preserved|miniature|funicular)$"](${BBOX});
out geom;`,
    keep: { name: "name", railway: "railway", gauge: "gauge", usage: "usage" },
  },
  {
    out: "bridges.geojson",
    label: "bridges",
    mode: "line",
    query: `[out:json][timeout:180];
way["bridge"](${BBOX});
out geom;`,
    keep: { name: "name", bridge: "bridge", highway: "highway", railway: "railway" },
    isFeature: (t) => t.bridge && t.bridge !== "no",
  },
  {
    out: "traffic-signals.geojson",
    label: "traffic signals",
    mode: "point",
    query: `[out:json][timeout:180];
node["highway"="traffic_signals"](${BBOX});
out;`,
    keep: { name: "name", highway: "highway", crossing: "crossing", trafficSignals: "traffic_signals" },
  },
  {
    out: "ev-charging.geojson",
    label: "EV charging sites",
    mode: "point",
    query: `[out:json][timeout:180];
(
  node["amenity"="charging_station"](${BBOX});
  way["amenity"="charging_station"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      operator: "operator",
      capacity: "capacity",
      socketType2: "socket:type2",
      socketType2Output: "socket:type2:output",
      socketChademo: "socket:chademo",
      socketCcs: "socket:type2_combo",
      maxstay: "maxstay",
      fee: "fee",
    },
  },
  {
    out: "hydrography.geojson",
    label: "watercourses",
    mode: "line",
    query: `[out:json][timeout:180];
way["waterway"~"^(river|stream|canal|drain|ditch)$"](${BBOX});
out geom;`,
    keep: { name: "name", waterway: "waterway", intermittent: "intermittent", tidal: "tidal" },
  },
  {
    out: "protected-areas.geojson",
    label: "protected areas",
    mode: "area",
    query: `[out:json][timeout:180];
(
  way["boundary"="protected_area"](${BBOX});
  way["leisure"="nature_reserve"](${BBOX});
);
out geom;`,
    keep: {
      name: "name",
      boundary: "boundary",
      leisure: "leisure",
      protectionTitle: "protection_title",
      designation: "designation",
      operator: "operator",
      ref: "ref",
    },
  },
  {
    out: "speed-limits.geojson",
    label: "speed limits",
    mode: "line",
    query: `[out:json][timeout:180];
way["highway"]["maxspeed"](${BBOX});
out geom;`,
    keep: { name: "name", highway: "highway", maxspeed: "maxspeed" },
  },
  {
    out: "reservoirs.geojson",
    label: "reservoirs",
    mode: "area",
    query: `[out:json][timeout:180];
(
  way["landuse"="reservoir"](${BBOX});
  way["water"="reservoir"](${BBOX});
);
out geom;`,
    keep: { name: "name", landuse: "landuse", water: "water", operator: "operator" },
  },
];

async function run() {
  console.log("OSM infrastructure ingest (Overpass, IoM bbox)");
  const report = [];

  for (const ds of DATASETS) {
    const file = `${OUT}/${ds.out}`;
    const body = await overpass(ds.query, ds.label);
    const features = [];
    for (const el of body.elements ?? []) {
      const t = el.tags ?? {};
      if (ds.isFeature && !ds.isFeature(t)) continue;
      // Unnamed linear features are kept: a road, stream or bridge with no name
      // is still real infrastructure. Only the layer's caveats say so.
      const f = toFeature(el, ds.mode, ds.keep);
      if (f) features.push(f);
    }

    const fc = { type: "FeatureCollection", name: ds.out.replace(/\.geojson$/, ""), features };
    const provenance = registryProvenance(ds.out);
    if (provenance) fc.properties = provenance;
    else console.warn(`  WARNING no registered layer claims ${ds.out}; provenance not stamped`);

    const bytes = writeJSON(file, fc);
    report.push({ file: ds.out, features: features.length, kb: Math.round(bytes / 1024) });
    console.log(
      `  ${String(features.length).padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${ds.out}`,
    );

    await sleep(3000); // be polite between Overpass queries
  }

  console.log("\nOSM infrastructure ingest complete.");
  for (const r of report) if (r.features === 0) console.warn(`  ! ${r.file} is EMPTY — check the query or drop the layer`);
}

run().catch((err) => {
  console.error("ingest-osm-infra failed:", err.message);
  process.exit(1);
});
