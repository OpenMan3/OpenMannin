/**
 * Address point ingestion from OpenStreetMap.
 *
 * The island's addresses are mapped in OSM in two shapes:
 *
 *   1. `addr:housenumber` (+ `addr:street`) on building nodes and ways — the
 *      numbered street addresses. 6,100+ ways and 800+ standalone nodes.
 *   2. `addr:housename` — named rural and heritage properties that have a name
 *      instead of a number (common on the Isle of Man). 2,000+ of these, which
 *      an earlier version of this script missed entirely.
 *
 * This script collects both plus the postcode, street/place and unit, and
 * writes one point per address. `addr:interpolation` ways (22 of them) are not
 * expanded: interpolating house numbers invents addresses that are not in the
 * source, so those streets carry only their explicitly mapped numbers.
 *
 *   node --experimental-strip-types scripts/ingest-housenumbers.mjs
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data/house-numbers.geojson";

function labelFor(t) {
  const number = t["addr:housenumber"];
  const name = t["addr:housename"];
  if (number && name) return `${number} ${name}`;
  return number ?? name ?? null;
}

/** Remove keys with null/undefined/empty-string values. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

async function main() {
  console.log("Address ingest (OSM addr:housenumber + addr:housename)");

  const body = await overpass(
    `[out:json][timeout:180];
(
  node["addr:housenumber"](${BBOX});
  way["addr:housenumber"](${BBOX});
  relation["addr:housenumber"](${BBOX});
  node["addr:housename"](${BBOX});
  way["addr:housename"](${BBOX});
);
out center body;`,
    "addresses",
  );

  const features = [];
  for (const el of body.elements ?? []) {
    const t = el.tags ?? {};
    const housenumber = t["addr:housenumber"] ?? null;
    const housename = t["addr:housename"] ?? null;
    if (!housenumber && !housename) continue;
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;

    features.push({
      type: "Feature",
      id: `${el.type}/${el.id}`,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 6),
      properties: compact({
        label: labelFor(t),
        housenumber,
        housename,
        street: t["addr:street"] ?? null,
        place: t["addr:place"] ?? null,
        postcode: t["addr:postcode"] ?? null,
        suburb: t["addr:suburb"] ?? t["addr:city"] ?? null,
        unit: t["addr:unit"] ?? t["addr:flats"] ?? null,
        kind: housenumber ? "number" : "name",
        source: "osm",
      }),
    });
  }

  const numbered = features.filter((f) => f.properties.housenumber).length;
  const named = features.filter((f) => !f.properties.housenumber && f.properties.housename).length;
  const withPostcode = features.filter((f) => f.properties.postcode).length;
  console.log(`  address points: ${features.length} (${numbered} numbered, ${named} named-only)`);
  console.log(`  with postcode:  ${withPostcode}`);

  const fc = {
    type: "FeatureCollection",
    name: "house-numbers",
    features,
    properties: registryProvenance("house-numbers.geojson") ?? {},
  };
  if (!fc.properties.source) console.warn("  WARNING no registered layer for house-numbers.geojson");

  const bytes = writeJSON(OUT, fc);
  console.log(`\nwrote ${OUT}: ${features.length} addresses, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("ingest-housenumbers failed:", err.message);
  process.exit(1);
});
