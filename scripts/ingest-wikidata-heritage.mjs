#!/usr/bin/env node
/**
 * Wikidata heritage-designation ingest (CC0).
 *
 * Wikidata's structured data is released under CC0 1.0, so it can be reused
 * with no attribution obligation and no share-alike. This is deliberately NOT
 * the official Isle of Man registered-buildings register (that is held by
 * government and is not open): it is a community-maintained, georeferenced
 * subset queried live from Wikidata, and the layer caveats say so.
 *
 * Query: items whose country (P17) is the Isle of Man (Q9676), that carry a
 * heritage designation (P1435) and a coordinate (P625).
 *
 *   node scripts/ingest-wikidata-heritage.mjs
 */

import { get, writeJSON } from "./lib/fetch.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";
const FILE = "heritage.geojson";
const ENDPOINT = "https://query.wikidata.org/sparql";

const QUERY = `SELECT ?item ?itemLabel ?desigLabel ?coord WHERE {
  ?item wdt:P17 wd:Q9676 .
  ?item wdt:P1435 ?desig .
  ?item wdt:P625 ?coord .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

/** Parse a Wikidata "Point(lon lat)" WKT literal. */
function parsePoint(wkt) {
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

async function run() {
  console.log("Wikidata heritage ingest (SPARQL, P17=Q9676, P1435, P625)");
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;
  const body = await get(url, {
    headers: { Accept: "application/sparql-results+json" },
    timeoutMs: 120_000,
  });
  const json = await body.json();
  const rows = json?.results?.bindings ?? [];
  if (!rows.length) throw new Error("Wikidata returned no heritage rows");

  const features = [];
  for (const r of rows) {
    const p = parsePoint(r.coord?.value);
    if (!p) continue;
    const qid = r.item?.value?.split("/").pop() ?? null;
    features.push({
      type: "Feature",
      id: qid,
      geometry: {
        type: "Point",
        coordinates: [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))],
      },
      properties: {
        id: qid,
        name: r.itemLabel?.value ?? "(unnamed)",
        designation: r.desigLabel?.value ?? null,
        wikidata: qid,
        wikidataUrl: r.item?.value ?? null,
      },
    });
  }

  // De-duplicate on QID: the SPARQL engine can return a row per designation.
  const seen = new Set();
  const deduped = features.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));

  const fc = { type: "FeatureCollection", name: "heritage", features: deduped };
  const provenance = registryProvenance(FILE);
  if (provenance) fc.properties = provenance;
  else console.warn(`  WARNING no registered layer claims ${FILE}; provenance not stamped`);

  const bytes = writeJSON(`${OUT}/${FILE}`, fc);
  console.log(
    `  ${String(deduped.length).padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${FILE}`,
  );
}

run().catch((err) => {
  console.error("ingest-wikidata-heritage failed:", err.message);
  process.exit(1);
});
