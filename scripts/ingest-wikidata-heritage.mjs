/**
 * Wikidata heritage ingest (SPARQL, P17=Q9676, P1435, P625).
 *
 * Items whose country (P17) is the Isle of Man (Q9676), that carry a heritage
 * designation (P1435) and a coordinate (P625). Beyond the designation itself we
 * pull a few enrichments where Wikidata has them: inception (P571), a Commons
 * image (P18), an official website (P856) and the administrative entity (P131).
 *
 *   node scripts/ingest-wikidata-heritage.mjs
 */

import { get, writeJSON } from "./lib/fetch.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";
const FILE = "heritage.geojson";
const ENDPOINT = "https://query.wikidata.org/sparql";

const QUERY = `SELECT ?item ?itemLabel ?desigLabel ?coord ?inception ?image ?website ?adminLabel WHERE {
  ?item wdt:P17 wd:Q9676 .
  ?item wdt:P1435 ?desig .
  ?item wdt:P625 ?coord .
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P856 ?website . }
  OPTIONAL { ?item wdt:P131 ?admin . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

/** Parse a Wikidata "Point(lon lat)" WKT literal. */
function parsePoint(wkt) {
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

/** Reduce an ISO datetime to its year, when one is present. */
function yearOf(value) {
  const m = /^(-?\d{1,4})-\d{2}-\d{2}/.exec(value ?? "");
  return m ? Number(m[1]) : null;
}

async function run() {
  console.log("Wikidata heritage ingest (SPARQL, P17=Q9676, P1435, P625, enriched)");
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;
  const body = await get(url, {
    headers: { Accept: "application/sparql-results+json" },
    timeoutMs: 120_000,
  });
  const json = await body.json();
  const rows = json?.results?.bindings ?? [];
  if (!rows.length) throw new Error("Wikidata returned no heritage rows");

  // The engine returns one row per designation (and one per optional value), so
  // fold the rows for a QID back into a single feature: collect the repeated
  // values and take the first for the one-per-item scalars.
  const byId = new Map();
  for (const r of rows) {
    const p = parsePoint(r.coord?.value);
    if (!p) continue;
    const qid = r.item?.value?.split("/").pop() ?? null;
    if (!qid) continue;

    let f = byId.get(qid);
    if (!f) {
      f = {
        type: "Feature",
        id: qid,
        geometry: {
          type: "Point",
          coordinates: [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))],
        },
        properties: {
          id: qid,
          name: r.itemLabel?.value ?? "(unnamed)",
          designations: [],
          inception: null,
          commonsImage: null,
          website: null,
          adminEntity: null,
          wikidata: qid,
          wikidataUrl: r.item?.value ?? null,
        },
      };
      byId.set(qid, f);
    }

    const props = f.properties;
    const desig = r.desigLabel?.value ?? null;
    if (desig && !props.designations.includes(desig)) props.designations.push(desig);
    if (props.inception == null) props.inception = yearOf(r.inception?.value);
    if (!props.commonsImage && r.image?.value) {
      props.commonsImage = r.image.value.replace(/^http:/, "https:");
    }
    if (!props.website && r.website?.value) props.website = r.website.value;
    if (!props.adminEntity && r.adminLabel?.value) props.adminEntity = r.adminLabel.value;
  }

  const features = [...byId.values()];

  const fc = { type: "FeatureCollection", name: "heritage", features };
  const provenance = registryProvenance(FILE);
  if (provenance) fc.properties = provenance;
  else console.warn(`  WARNING no registered layer claims ${FILE}; provenance not stamped`);

  const bytes = writeJSON(`${OUT}/${FILE}`, fc);
  console.log(
    `  ${String(features.length).padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${FILE}`,
  );
}

run().catch((err) => {
  console.error("ingest-wikidata-heritage failed:", err.message);
  process.exit(1);
});
