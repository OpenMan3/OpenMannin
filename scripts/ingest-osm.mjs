/**
 * OpenStreetMap ingest for the place-name and seamark layers.
 *
 * Why this file exists
 * --------------------
 * The layer previously called "toponyms / Field Gazetteer (place names)" was
 * wrong. The government "Field Gazetteer" layer contains 19,848 features and
 * not one of them has a name. Its fields are PLOT, START, ACRES3D, CATEGORY,
 * OCCUP_CURR and USECOD_CURR — it is an agricultural field parcel dataset, not
 * a gazetteer. Rendered as a point layer it was 3 MB of coordinates with
 * nothing to label. That layer is not openly licensed and has been removed.
 *
 * No official place-name gazetteer is published as open data, so this file
 * pulls real toponyms from OpenStreetMap under the ODbL. See the gazetteer gap
 * entry for how that is disclosed.
 *
 * It also fills seamarks, for which no official layer is published, and which
 * the layers register already expected at seamarks.geojson.
 *
 * Overpass etiquette: one query at a time, bounded to the Isle of Man, honest
 * User-Agent. The endpoint returns 504 under load, so each query is retried
 * with backoff and a failure is reported rather than written as an empty file.
 */

import { UA, get, writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";

// Overpass mirrors in preference order. overpass-api.de is the canonical
// instance but is chronically overloaded (and occasionally down for days, as
// the 504s through the middle of this project show); kumi.systems is a public
// mirror; the mail.ru instance is the only one that has been continuously
// reliable from here. Each query tries them in turn rather than trusting one.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const BBOX = "54.02,-4.85,54.45,-4.30"; // south, west, north, east

async function overpass(query, label) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of OVERPASS) {
      try {
        const res = await get(ep, {
          method: "POST",
          // Overpass answers HTTP 406 to any browser-shaped User-Agent, which is
          // what the shared get() helper sends by default (it exists to get past
          // the F5 WAF on gov.im). Overpass wants a plain identifying string
          // instead, so override it rather than lie about being a browser here.
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }).toString(),
          timeoutMs: 180_000,
          retries: 0,
        });
        const json = await res.json();
        // An empty answer is as useless as an error: a seamark-free Isle of
        // Man does not exist. Count zero as a mirror failure and move on.
        if ((json.elements ?? []).length > 0) return json;
        lastErr = new Error(`empty response for ${label} from ${ep}`);
        console.log(`  ${label}: empty response from ${ep}, trying next mirror`);
      } catch (err) {
        lastErr = err;
        console.log(`  ${label}: ${ep} failed (${err.message.slice(0, 80)}), trying next mirror`);
      }
    }
    console.log(`  ${label}: attempt ${attempt + 1} exhausted all mirrors, retrying`);
    await sleep(5000 * (attempt + 1));
  }
  throw lastErr;
}

/**
 * Significance ordering for labels.
 *
 * OSM's own `place_rank` tag lives mostly on relations, not on the nodes that
 * carry the name, so reading it gives 99 for nearly every result and makes the
 * "drop the least significant labels first" rule a no-op. Fall back to a coarse
 * ranking derived from the `place` tag, which is always present.
 */
const PLACE_IMPORTANCE = {
  city: 1,
  town: 2,
  borough: 3,
  suburb: 4,
  village: 5,
  hamlet: 6,
  locality: 7,
  isolated_dwelling: 8,
  farm: 9,
  allotments: 10,
  quarter: 11,
  neighbourhood: 12,
  square: 13,
};

function significance(tags) {
  const declared = Number(tags.place_rank);
  if (Number.isInteger(declared) && declared > 0) return declared;
  return PLACE_IMPORTANCE[tags.place] ?? 50;
}

/** Overpass lat/lon -> GeoJSON lon/lat, honouring `center` for ways/relations. */
function toFeature(el, placeRank) {
  let lon = el.lon;
  let lat = el.lat;
  if (lat === undefined || lon === undefined) {
    const c = el.center;
    if (!c) return null;
    lon = c.lon;
    lat = c.lat;
  }
  const t = el.tags ?? {};
  const name = t.name ?? t["name:en"] ?? null;
  if (!name) return null;

  const geom = roundCoords({ type: "Point", coordinates: [lon, lat] }, 5);
  return {
    type: "Feature",
    id: `${el.type}/${el.id}`,
    geometry: geom,
    properties: {
      id: `${el.type}/${el.id}`,
      name,
      place: t.place ?? null,
      /** Lower is more significant: OSM place_rank where present, else derived from place. */
      rank: placeRank,
      population: t.population ? Number(t.population) : null,
      wikidata: t.wikidata ?? null,
      altName: t.alt_name ?? null,
      oldName: t.old_name ?? null,
      source: "osm",
    },
  };
}

let droppedCount = 0;

async function ingestToponyms() {
  const query = `[out:json][timeout:180];
(
  node["place"]["name"](${BBOX});
  way["place"]["name"](${BBOX});
  relation["place"]["name"](${BBOX});
);
out center 3000;`;
  const body = await overpass(query, "toponyms");
  const features = [];
  for (const el of body.elements ?? []) {
    const f = toFeature(el, significance(el.tags ?? {}));
    if (f) features.push(f);
  }
  // Most significant first, so a label renderer can stop early.
  features.sort((a, b) => a.properties.rank - b.properties.rank);

  // The same settlement is often mapped as both a node and a way or relation
  // ("Douglas" appears twice, "Ramsey" twice, and so on). A label layer must
  // not draw the same name twice on top of itself, so keep the most significant
  // instance of each name. Features are already sorted, so first-wins keeps the
  // best-ranked one.
  const seenNames = new Set();
  const deduped = [];
  let dropped = 0;
  for (const f of features) {
    const key = f.properties.name.trim().toLowerCase();
    if (seenNames.has(key)) {
      dropped++;
      continue;
    }
    seenNames.add(key);
    deduped.push(f);
  }
  droppedCount = dropped;
  features.length = 0;
  features.push(...deduped);

  const fc = {
    type: "FeatureCollection",
    name: "toponyms",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors",
      licence: "ODbL",
      note:
        "Replaces a mislabelled government 'Field Gazetteer' that had no name field at all — it was agricultural field parcels, not place names.",
      caveats: [
        "OSM names, not an official national gazetteer. Coverage and spelling vary with local mapping activity.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };
  const bytes = writeJSON("public/data/toponyms.geojson", fc);
  return { bytes, count: features.length, dropped: droppedCount };
}

async function ingestSeamarks() {
  const query = `[out:json][timeout:180];
(
  node["man_made"~"^(beacon|lighthouse)$"](${BBOX});
  way["man_made"~"^(beacon|lighthouse)$"](${BBOX});
  node["seamark:type"](${BBOX});
  way["seamark:type"](${BBOX});
);
out center 1000;`;
  const body = await overpass(query, "seamarks");
  const features = [];
  for (const el of body.elements ?? []) {
    const t = el.tags ?? {};
    const name = t.name ?? null;
    // A beacon with no name is still real; keep it but say so.
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;

    features.push({
      type: "Feature",
      id: `${el.type}/${el.id}`,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 5),
      properties: {
        id: `${el.type}/${el.id}`,
        name: name ?? "(unnamed)",
        named: name !== null,
        kind: t.man_made ?? t["seamark:type"] ?? null,
        seamarkType: t["seamark:type"] ?? null,
        /** OSM seamark characteristics are spotty; do not present as authoritative. */
        colour: t["seamark:colour"] ?? null,
        lightRange: t["seamark:range"] ?? null,
        source: "osm",
      },
    });
  }

  const fc = {
    type: "FeatureCollection",
    name: "seamarks",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors",
      licence: "ODbL",
      caveats: [
        "OpenStreetMap, not a UKHO or Northern Lighthouse Board publication.",
        "Characteristics (range, colour, period) are frequently absent or wrong in OSM. Unnamed beacons are genuine but unidentified.",
        "Chicken Rock, Calf of Man, Point of Ayre and Bradda Head are the notable Manx lights.",
      ],
    },
    features,
  };
  const bytes = writeJSON("public/data/seamarks.geojson", fc);
  return { bytes, count: features.length };
}

async function main() {
  console.log("OSM ingest (Overpass, IoM bbox)");

  const t = await ingestToponyms();
  console.log(`  toponyms.geojson   ${t.count} places (${t.dropped} duplicate names dropped), ${(t.bytes / 1024).toFixed(1)} KB`);

  await sleep(2000); // be polite between Overpass queries

  const s = await ingestSeamarks();
  console.log(`  seamarks.geojson   ${s.count} features, ${(s.bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error("ingest-osm failed:", err.message);
  process.exitCode = 1;
});