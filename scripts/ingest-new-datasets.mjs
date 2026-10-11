#!/usr/bin/env node
/**
 * Ingest new OSM datasets (emergency, footpaths, schools-health, tourism, worship)
 */

import { writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";

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
  node["emergency"="defibrillator"](${BBOX});
  way["emergency"="defibrillator"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      emergency: "emergency",
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
  node["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|artwork|memorial|monument)$"](${BBOX});
  way["tourism"~"^(attraction|viewpoint|museum|gallery|zoo|theme_park|artwork|memorial|monument)$"](${BBOX});
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
  console.log("OSM infrastructure ingest - NEW DATASETS (Overpass, IoM bbox)");
  const report = [];

  for (const ds of DATASETS) {
    const file = `${OUT}/${ds.out}`;
    const body = await overpass(ds.query, ds.label);
    const features = [];
    for (const el of body.elements ?? []) {
      const t = el.tags ?? {};
      if (ds.isFeature && !ds.isFeature(t)) continue;
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

    await sleep(8000); // be very polite
  }

  console.log("\nOSM infrastructure ingest complete.");
  for (const r of report) if (r.features === 0) console.warn(`  ! ${r.file} is EMPTY — check the query or drop the layer`);
}

run().catch((err) => {
  console.error("ingest failed:", err.message);
  process.exit(1);
});