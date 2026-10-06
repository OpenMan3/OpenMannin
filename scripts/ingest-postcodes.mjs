/**
 * Postcode index ingestion from OpenStreetMap.
 *
 * The Isle of Man uses UK-style postcodes (IM1–IM99). There is no official
 * postcode gazetteer — the Post Office does not publish one, and Code-Point
 * Open covers GB only. OSM carries `addr:postcode` on buildings and
 * addresses across the island, which is the only open, machine-readable
 * source.
 *
 * This script queries every node/way/relation with an `addr:postcode` tag
 * within the IoM bbox, groups them by postcode, and writes:
 *
 *   public/data/postcodes.geojson      — one point per postcode (centroid)
 *   public/data/postcodes-index.json  — compact array for prefix search
 *
 * The index is small (a few hundred postcodes) and ships as a static file,
 * so the UI can do instant client-side prefix matching with no network.
 *
 *   node --experimental-strip-types scripts/ingest-postcodes.mjs
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

/** Haversine metres between two lon/lat points. */
function metres([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function main() {
  console.log("Postcode index ingest (OSM addr:postcode)");

  const body = await overpass(
    `[out:json][timeout:120];
(
  node["addr:postcode"](${BBOX});
  way["addr:postcode"](${BBOX});
  relation["addr:postcode"](${BBOX});
);
out center body;`,
    "postcodes",
  );

  // Group by postcode: collect all coordinates for centroid + count.
  const byCode = new Map();
  for (const el of body.elements ?? []) {
    const code = el.tags?.["addr:postcode"];
    if (!code) continue;
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;
    const key = code.trim().toUpperCase();
    if (!byCode.has(key)) byCode.set(key, { lons: [], lats: [], count: 0 });
    const entry = byCode.get(key);
    entry.lons.push(lon);
    entry.lats.push(lat);
    entry.count++;
  }

  console.log(`  distinct postcodes: ${byCode.size}`);

  // Build the geojson (one point per postcode) and the compact index.
  const features = [];
  const index = [];
  for (const [code, { lons, lats, count }] of byCode) {
    const lon = lons.reduce((a, b) => a + b, 0) / lons.length;
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length;
    features.push({
      type: "Feature",
      id: code,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 5),
      properties: {
        code,
        addresses: count,
        source: "osm",
      },
    });
    index.push({ code, lon: Number(lon.toFixed(5)), lat: Number(lat.toFixed(5)), count });
  }

  // Sort by code for stable output.
  features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  index.sort((a, b) => a.code.localeCompare(b.code));

  const fc = {
    type: "FeatureCollection",
    name: "postcodes",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors",
      licence: "ODbL",
      caveats: [
        "Postcode centroids are the mean of all OSM addresses tagged with that postcode. They are approximate — a postcode covers a street or block, not a point.",
        "Coverage depends on OSM mapping activity. Rural and newly-built areas may be missing postcodes.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };

  const bytes = writeJSON("public/data/postcodes.geojson", fc);
  writeJSON("public/data/postcodes-index.json", index);
  console.log(`\nwrote postcodes.geojson: ${features.length} postcodes, ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`wrote postcodes-index.json: ${index.length} entries`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});