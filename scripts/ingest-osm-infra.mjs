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

import { writeJSON, sleep, roundCoords, simplifyGeometry } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";

/**
 * Douglas-Peucker tolerance, in degrees, for line and polygon layers.
 *
 * 1e-5 deg is about 1 m here: far below one pixel at the deepest zoom the app
 * reaches, but it removes the metre-accurate micro-vertices that made roads
 * and footpaths tens of MB of GeoJSON. The tester lives in scripts/lib/fetch.mjs
 * and is shared with the cable ingest.
 */
const SIMPLIFY_TOL = 1e-5;

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
    // Douglas-Peucker simplification before rounding keeps line/area files
    // small while staying visually exact at any zoom the app reaches.
    geometry = simplifyGeometry(geometry, SIMPLIFY_TOL);
    if (!geometry) return null;
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
    // Road classes ONLY. Footways, paths, steps, bridleways, pedestrian
    // precincts and cycleways belong to the footpaths layer; querying bare
    // way["highway"] duplicated that whole layer here (~9,000 features).
    query: `[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${BBOX});
out geom;`,
    keep: { name: "name", highway: "highway", ref: "ref", surface: "surface", oneway: "oneway", junction: "junction", access: "access", motorVehicle: "motor_vehicle", motorcar: "motorcar", vehicle: "vehicle", foot: "foot", bicycle: "bicycle", service: "service", maxspeed: "maxspeed" },
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
  {
    out: "emergency.geojson",
    label: "emergency services",
    mode: "point",
    query: `[out:json][timeout:180];
(
  node["amenity"="police"](${BBOX});
  way["amenity"="police"](${BBOX});
  node["amenity"="fire_station"](${BBOX});
  way["amenity"="fire_station"](${BBOX});
  node["amenity"="ambulance_station"](${BBOX});
  way["amenity"="ambulance_station"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      operator: "operator",
      phone: "phone",
      contactPhone: "contact:phone",
      openingHours: "opening_hours",
      access: "access",
    },
  },
  {
    out: "footpaths.geojson",
    label: "footpaths & PRoW",
    mode: "line",
    query: `[out:json][timeout:180];
way["highway"~"^(footway|path|bridleway|steps)$"](${BBOX});
out geom;`,
    keep: { name: "name", highway: "highway", foot: "foot", bicycle: "bicycle", horse: "horse", surface: "surface", designation: "designation", access: "access" },
  },
  {
    out: "schools-health.geojson",
    label: "schools & health",
    mode: "point",
    query: `[out:json][timeout:180];
(
  node["amenity"~"^(school|college|university|kindergarten)$"](${BBOX});
  way["amenity"~"^(school|college|university|kindergarten)$"](${BBOX});
  node["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy|veterinary)$"](${BBOX});
  way["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy|veterinary)$"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      operator: "operator",
      phone: "phone",
      website: "website",
      openingHours: "opening_hours",
      capacity: "capacity",
      healthcare: "healthcare",
    },
  },
  {
    out: "tourism.geojson",
    label: "tourism",
    mode: "point",
    query: `[out:json][timeout:180];
(
  node["tourism"~"^(attraction|museum|gallery|zoo|theme_park|artwork|memorial|monument)$"](${BBOX});
  way["tourism"~"^(attraction|museum|gallery|zoo|theme_park|artwork|memorial|monument)$"](${BBOX});
  node["tourism"="camp_site"](${BBOX});
  way["tourism"="camp_site"](${BBOX});
  node["tourism"="hostel"](${BBOX});
  way["tourism"="hostel"](${BBOX});
  node["tourism"="hotel"](${BBOX});
  way["tourism"="hotel"](${BBOX});
  node["tourism"="guest_house"](${BBOX});
  way["tourism"="guest_house"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      tourism: "tourism",
      operator: "operator",
      phone: "phone",
      website: "website",
      openingHours: "opening_hours",
      stars: "stars",
      capacity: "capacity",
      fee: "fee",
    },
  },
  {
    out: "worship.geojson",
    label: "places of worship",
    mode: "point",
    query: `[out:json][timeout:180];
(
  node["amenity"="place_of_worship"](${BBOX});
  way["amenity"="place_of_worship"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      religion: "religion",
      denomination: "denomination",
      operator: "operator",
      phone: "phone",
      website: "website",
      building: "building",
    },
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
