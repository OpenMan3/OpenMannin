/**
 * House number ingestion from OpenStreetMap.
 *
 * OSM carries addr:housenumber + addr:street on building nodes and ways
 * across the island. This script collects them all and writes a point
 * layer (one point per address).
 *
 *   node --experimental-strip-types scripts/ingest-housenumbers.mjs
 */

import { UA, writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";

const BBOX = "54.02,-4.85,54.45,-4.30";

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function overpass(query, label) {
  const deadline = Date.now() + 240_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    for (const ep of OVERPASS) {
      if (Date.now() >= deadline) break;
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("non-JSON response (error page)");
        }
        if ((json.elements ?? []).length > 0) return json;
        throw new Error(`empty response for ${label} from ${ep}`);
      } catch (err) {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        console.log(`  ${label}: ${ep} failed (${err.message.slice(0, 70)}), ${left}s left`);
      }
    }
    if (Date.now() < deadline) {
      console.log(`  ${label}: attempt ${attempt} exhausted mirrors, retrying`);
      await sleep(4000);
    }
  }
  throw new Error(`overpass exhausted for ${label}`);
}

async function main() {
  console.log("House number ingest (OSM addr:housenumber)");

  const body = await overpass(
    `[out:json][timeout:120];
(
  node["addr:housenumber"](${BBOX});
  way["addr:housenumber"](${BBOX});
);
out center body;`,
    "house-numbers",
  );

  const features = [];
  for (const el of body.elements ?? []) {
    const t = el.tags ?? {};
    const housenumber = t["addr:housenumber"];
    if (!housenumber) continue;
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;

    const street = t["addr:street"] ?? null;
    const postcode = t["addr:postcode"] ?? null;
    const suburb = t["addr:suburb"] ?? t["addr:city"] ?? null;
    const unit = t["addr:unit"] ?? t["addr:flats"] ?? null;

    features.push({
      type: "Feature",
      id: `${el.type}/${el.id}`,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 6),
      properties: {
        housenumber,
        street,
        postcode,
        suburb,
        unit,
        source: "osm",
      },
    });
  }

  console.log(`  address features: ${features.length}`);

  const withStreet = features.filter((f) => f.properties.street).length;
  const withPostcode = features.filter((f) => f.properties.postcode).length;
  console.log(`  with street: ${withStreet}, with postcode: ${withPostcode}`);

  const fc = {
    type: "FeatureCollection",
    name: "house-numbers",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors",
      licence: "ODbL",
      caveats: [
        "Coverage depends on OSM mapping activity. Rural and newly-built areas may be incomplete.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };

  const bytes = writeJSON("public/data/house-numbers.geojson", fc);
  console.log(`\nwrote house-numbers.geojson: ${features.length} addresses, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});