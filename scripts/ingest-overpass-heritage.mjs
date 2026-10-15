#!/usr/bin/env node
/**
 * Expanded OSM industrial-heritage, ruins and monument ingest.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The island's most distinctive historic fabric — the lead, copper and zinc
 * workings of Laxey, Foxdale and Snaefell, the quarries and lime kilns, the
 * keeills and monuments, and the tholtans (ruinously abandoned buildings) —
 * is not published by any open official dataset. Manx National Heritage holds
 * the authoritative Historic Environment Record, but it is not open data. So
 * this layer set is built from OpenStreetMap under the ODbL, which is the only
 * open route to it.
 *
 * It SUPERSEDES the heritage queries that used to live in fetch-osm-layers.ts
 * (mine_infrastructure, tholtans_ruins) and update-data.mjs (archaeology), and
 * widens them: quarry, lime_kiln, kiln, water_wheel, spoil_heap, keeills and
 * monuments. Coverage is meaningfully deeper — monuments go from ~140 to ~280
 * records and industrial heritage from ~19 to ~30.
 *
 * ONE QUERY, THREE FILES, NO DUPLICATES
 * -------------------------------------
 * The tag sets overlap in OSM, so querying them separately would ship the same
 * element in two files. Instead this runs a single combined Overpass query and
 * assigns each element to exactly one of the three output layers by priority
 * (see scripts/lib/heritage-classify.mjs). The layers are therefore disjoint
 * by construction, which is what verify-registry's duplicate check asserts.
 *
 * Every output file carries the provenance block resolved from the registers
 * the UI renders, and mine shafts/adits carry a per-feature `safety` warning,
 * because a point on a map is an invitation to stand on it.
 *
 *   node --experimental-strip-types --no-warnings scripts/ingest-overpass-heritage.mjs
 */

import { writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";
import {
  assignLayer,
  classify,
  safetyWarning,
  dedupeByPoint,
  HERITAGE_LAYERS,
  INDUSTRIAL_MAN_MADE,
  INDUSTRIAL_HISTORIC,
  MONUMENT_HISTORIC,
} from "./lib/heritage-classify.mjs";

const OUT = "public/data";

const rx = (set) => `^(${[...set].join("|")})$`;

// One union of every heritage selector. `out center;` guarantees a point for
// nodes, ways and relations alike, which is the only geometry these layers
// ship: a monument or a ruin is a place, not a footprint.
const QUERY = `[out:json][timeout:180];
(
  nwr["man_made"~"${rx(INDUSTRIAL_MAN_MADE)}"](${BBOX});
  nwr["historic"~"${rx(INDUSTRIAL_HISTORIC)}"](${BBOX});
  nwr["historic"~"${rx(MONUMENT_HISTORIC)}"](${BBOX});
  nwr["archaeological_site"~"^(keill|keeil)$"](${BBOX});
  nwr["historic"="ruins"](${BBOX});
  nwr["building"="ruins"](${BBOX});
  nwr["ruins"="yes"](${BBOX});
  nwr["abandoned:building"](${BBOX});
  nwr["historic"="building"](${BBOX});
  nwr["disused"="yes"](${BBOX});
);
out center;`;

/** Extra OSM tags kept per layer, as output property -> source OSM tag. */
const KEEP = {
  mine: {
    resource: "resource",
    depth: "depth",
    operator: "operator",
    access: "access",
    disused: "disused",
    ruins: "ruins",
  },
  archaeology: {
    siteType: "site_type",
    megalithType: "megalith_type",
    heritage: "heritage",
    ref: "ref",
  },
  ruins: {
    historic: "historic",
    building: "building",
    abandoned: "abandoned:building",
    disused: "disused",
    ruins: "ruins",
    place: "place",
  },
};

/**
 * Convert one Overpass element into a standardised point feature.
 *
 * Standard properties every feature carries: `name`, `type`, `description`,
 * `lat`, `lon` (plus `id`/`osm`). Layer-specific OSM tags are added on top,
 * and `safety` where the feature is a shaft or an adit.
 */
function toFeature(el, layer) {
  const t = el.tags ?? {};
  const lon = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (lon === undefined || lat === undefined) return null;

  const osm = `${el.type}/${el.id}`;
  const props = {
    id: osm,
    name: t.name ?? t["name:en"] ?? null,
    type: classify(layer, t),
    description: t.description ?? null,
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };
  for (const [dest, src] of Object.entries(KEEP[layer])) {
    const v = t[src];
    if (v !== undefined && v !== "") props[dest] = v;
  }
  const safety = safetyWarning(t);
  if (safety) props.safety = safety;
  if (t.wikidata) props.wikidata = t.wikidata;
  if (t.wikipedia) props.wikipedia = t.wikipedia;
  props.osm = osm;

  return {
    type: "Feature",
    id: osm,
    geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 6),
    properties: props,
  };
}

async function run() {
  console.log("OSM heritage ingest (Overpass, IoM bbox) — mines, monuments & ruins");
  const body = await overpass(QUERY, "heritage");

  const byLayer = { mine: [], archaeology: [], ruins: [] };
  const seenIds = new Set();
  let unclaimed = 0;
  let duplicateElements = 0;

  for (const el of body.elements ?? []) {
    const t = el.tags ?? {};
    const layer = assignLayer(t);
    if (!layer) {
      unclaimed += 1;
      continue;
    }
    const osm = `${el.type}/${el.id}`;
    // Defence in depth: Overpass already de-duplicates a union result, but a
    // repeated element would otherwise be the one silent way two features
    // could enter the same layer twice.
    if (seenIds.has(osm)) {
      duplicateElements += 1;
      continue;
    }
    seenIds.add(osm);

    const f = toFeature(el, layer);
    if (f) byLayer[layer].push(f);
  }

  const report = [];
  for (const [layer, file] of Object.entries(HERITAGE_LAYERS)) {
    const before = byLayer[layer].length;
    const { features, dropped } = dedupeByPoint(byLayer[layer]);

    const fc = {
      type: "FeatureCollection",
      name: file.replace(/\.geojson$/, ""),
      features,
    };
    const provenance = registryProvenance(file);
    if (provenance) fc.properties = provenance;
    else console.warn(`  WARNING no registered layer claims ${file}; provenance not stamped`);

    const bytes = writeJSON(`${OUT}/${file}`, fc);
    report.push({ layer, file, features: features.length, dropped, before, kb: Math.round(bytes / 1024) });
    console.log(
      `  ${String(features.length).padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${file}` +
        (dropped ? `  (${dropped} same-point duplicates dropped)` : ""),
    );
  }

  // Cross-layer disjointness is the whole point of the single-query design, so
  // prove it here rather than trusting the priority table.
  const overlaps = crossLayerOverlaps(byLayer);
  logSummary({ report, unclaimed, duplicateElements, overlaps });
  await sleep(1000);
}

/** Count coordinate keys shared between each pair of the three layers. */
function crossLayerOverlaps(byLayer) {
  const keyOf = (f) => {
    const [lon, lat] = f.geometry.coordinates;
    return `${Number(lon).toFixed(5)},${Number(lat).toFixed(5)}`;
  };
  const names = Object.keys(byLayer);
  const rows = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = new Set(byLayer[names[i]].map(keyOf));
      const shared = byLayer[names[j]].filter((f) => a.has(keyOf(f))).length;
      if (shared > 0) rows.push(`${names[i]} ∩ ${names[j]} = ${shared}`);
    }
  }
  return rows;
}

function logSummary({ report, unclaimed, duplicateElements, overlaps }) {
  const total = report.reduce((n, r) => n + r.features, 0);
  console.log(`\n  total           ${total} features across ${report.length} layers`);
  if (duplicateElements) console.log(`  duplicate els   ${duplicateElements} dropped (same OSM element twice)`);
  if (unclaimed) console.log(`  unclaimed       ${unclaimed} elements matched a selector but no owner`);
  if (overlaps.length) {
    console.log(`  OVERLAP         ${overlaps.join("; ")}`);
    console.log("                  layers must be disjoint — refine assignLayer() before shipping");
    process.exitCode = 1;
  } else {
    console.log("  disjoint        the three layers share no coordinate");
  }
  for (const r of report) {
    if (r.features === 0) console.warn(`  ! ${r.file} is EMPTY — check the query or drop the layer`);
  }
}

run().catch((err) => {
  console.error("ingest-overpass-heritage failed:", err.message);
  process.exit(1);
});
