#!/usr/bin/env node
/**
 * OpenStreetMap points-of-interest ingest for the "Points of interest" group.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There is no open, machine-readable dataset for the Isle of Man's everyday
 * utility POIs, food and drink, or coastal/outdoor access points. The island's
 * own map services are Crown copyright and excluded from the OGL, so OpenMannin
 * builds these layers from OpenStreetMap under the ODbL instead.
 *
 * Three layers, one Overpass pass each, all reduced to points (a POI needs an
 * anchor, not a footprint):
 *
 *   essential_utilities.geojson   amenity=fuel|atm|bank|toilets, emergency=defibrillator
 *   food_drink.geojson            amenity=restaurant|cafe|pub|bar
 *   coastal_outdoor.geojson       leisure=slipway, tourism=viewpoint|picnic_site, amenity=parking
 *
 * The heritage layers this script used to build — mine_infrastructure and
 * tholtans_ruins — are now owned by scripts/ingest-overpass-heritage.mjs, which
 * queries mines, quarries, monuments and ruins together so the three heritage
 * layers stay disjoint.
 *
 * Every output file carries the provenance block resolved from the same
 * registers the UI renders, so the file explains its own source and licence
 * without the app.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings scripts/fetch-osm-layers.ts
 */

import { writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";

/** Overpass tags are a string map (values are strings in practice). */
type Tags = Record<string, string | undefined>;

/** A representative point, kept from the Overpass element's tags. */
type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Tags;
};

type Dataset = {
  /** Output filename under public/data. */
  out: string;
  /** Human label for the log line and error messages. */
  label: string;
  /** Overpass QL. Must end in `out center;` so ways/relations get a point. */
  query: string;
  /** dest property -> source OSM tag. */
  keep: Record<string, string>;
  /** Derive the human sub-type used for the feature label. */
  classify: (t: Tags) => string;
};

const DATASETS: Dataset[] = [
  {
    out: "essential_utilities.geojson",
    label: "essential utilities",
    query: `[out:json][timeout:180];
(
  nwr["amenity"~"^(fuel|atm|bank|toilets)$"](${BBOX});
  nwr["emergency"="defibrillator"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      emergency: "emergency",
      operator: "operator",
      brand: "brand",
      phone: "phone",
      contactPhone: "contact:phone",
      website: "website",
      openingHours: "opening_hours",
      fee: "fee",
      access: "access",
      wheelchair: "wheelchair",
    },
    classify: (t) => {
      if (t["emergency"] === "defibrillator") return "Defibrillator";
      const a = t["amenity"];
      if (a === "fuel") return "Fuel station";
      if (a === "atm") return "ATM";
      if (a === "bank") return "Bank";
      if (a === "toilets") return "Public toilets";
      return "Utility";
    },
  },
  {
    out: "food_drink.geojson",
    label: "food & drink",
    query: `[out:json][timeout:180];
nwr["amenity"~"^(restaurant|cafe|pub|bar)$"](${BBOX});
out center;`,
    keep: {
      name: "name",
      amenity: "amenity",
      cuisine: "cuisine",
      operator: "operator",
      brand: "brand",
      phone: "phone",
      website: "website",
      openingHours: "opening_hours",
      outdoorSeating: "outdoor_seating",
      wheelchair: "wheelchair",
      fee: "fee",
    },
    classify: (t) => {
      const a = t["amenity"];
      if (a === "restaurant") return "Restaurant";
      if (a === "cafe") return "Cafe";
      if (a === "pub") return "Pub";
      if (a === "bar") return "Bar";
      return "Food & drink";
    },
  },
  {
    out: "coastal_outdoor.geojson",
    label: "coastal & outdoor",
    query: `[out:json][timeout:180];
(
  nwr["leisure"="slipway"](${BBOX});
  nwr["tourism"~"^(viewpoint|picnic_site)$"](${BBOX});
  nwr["amenity"="parking"](${BBOX});
);
out center;`,
    keep: {
      name: "name",
      leisure: "leisure",
      tourism: "tourism",
      amenity: "amenity",
      operator: "operator",
      surface: "surface",
      access: "access",
      fee: "fee",
      capacity: "capacity",
      parking: "parking",
      wheelchair: "wheelchair",
    },
    classify: (t) => {
      if (t["leisure"] === "slipway") return "Slipway";
      if (t["tourism"] === "viewpoint") return "Viewpoint";
      if (t["tourism"] === "picnic_site") return "Picnic site";
      if (t["amenity"] === "parking") return "Car park";
      return "Outdoor feature";
    },
  },
];

/** Convert one Overpass element to an anchored GeoJSON point feature. */
function toPointFeature(el: OverpassElement, ds: Dataset) {
  const lon = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (lon === undefined || lat === undefined) return null;

  const t = el.tags ?? {};
  const props: Record<string, unknown> = { kind: ds.classify(t) };
  for (const [dest, src] of Object.entries(ds.keep)) {
    const v = t[src];
    if (v !== undefined && v !== "") props[dest] = v;
  }
  if (t.wikidata) props.wikidata = t.wikidata;
  const osm = `${el.type}/${el.id}`;
  props.osm = osm;

  return {
    type: "Feature" as const,
    id: osm,
    geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 6),
    properties: { id: osm, ...props },
  };
}

async function run() {
  console.log("OSM points-of-interest ingest (Overpass, IoM bbox)");
  const report: { file: string; features: number; kb: number }[] = [];

  for (const ds of DATASETS) {
    const file = `${OUT}/${ds.out}`;
    const body = await overpass(ds.query, ds.label);
    const features = [];
    for (const el of (body.elements ?? []) as OverpassElement[]) {
      const f = toPointFeature(el, ds);
      if (f) features.push(f);
    }

    const fc: Record<string, unknown> = {
      type: "FeatureCollection",
      name: ds.out.replace(/\.geojson$/, ""),
      features,
    };
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

  console.log("\nOSM points-of-interest ingest complete.");
  for (const r of report) {
    if (r.features === 0) console.warn(`  ! ${r.file} is EMPTY — check the query or drop the layer`);
  }
}

run().catch((err) => {
  console.error("fetch-osm-layers failed:", err.message);
  process.exit(1);
});
