#!/usr/bin/env node
/**
 * Wikidata memorials and monuments for the Isle of Man (CC0).
 *
 * This complements the existing `heritage` layer, which is restricted to
 * items that carry a formal heritage designation (P1435). Most island war
 * memorials, statues, standing stones and commemorative markers are not
 * registered buildings, so they were invisible on the map even though
 * Wikidata has coordinates for them.
 *
 * Query: items whose country (P17) is the Isle of Man (Q9676), that are an
 * instance of monument, memorial, war memorial, or statue (P31), and that
 * carry a coordinate (P625).
 *
 *   node scripts/ingest-wikidata-memorials.mjs
 */

import { get, writeJSON } from "./lib/fetch.mjs";
import { registryProvenance } from "./lib/registry-provenance.mjs";

const OUT = "public/data";
const FILE = "wikidata-memorials.geojson";
const ENDPOINT = "https://query.wikidata.org/sparql";

const QUERY = `SELECT ?item ?itemLabel ?instanceLabel ?coord ?commons WHERE {
  ?item wdt:P17 wd:Q9676 .
  ?item wdt:P31 ?instance .
  ?item wdt:P625 ?coord .
  VALUES ?instance { wd:Q5003624 wd:Q130723 wd:Q575759 wd:Q179700 } .
  OPTIONAL { ?item wdt:P373 ?commons . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;

function parsePoint(wkt) {
  const m = /^Point\(([-\d.]+) ([-\d.]+)\)$/.exec(wkt ?? "");
  if (!m) return null;
  return { lon: Number(m[1]), lat: Number(m[2]) };
}

async function run() {
  console.log("Wikidata memorials ingest (SPARQL, P17=Q9676, P31 monument/memorial/statue, P625)");
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`;
  const body = await get(url, {
    headers: { Accept: "application/sparql-results+json" },
    timeoutMs: 120_000,
  });
  const json = await body.json();
  const rows = json?.results?.bindings ?? [];
  if (!rows.length) throw new Error("Wikidata returned no memorial rows");

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
        kind: r.instanceLabel?.value ?? null,
        wikidata: qid,
        wikidataUrl: r.item?.value ?? null,
        commons: r.commons?.value ?? null,
        licence: "CC0-1.0",
      },
    });
  }

  const seen = new Set();
  const deduped = features.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));

  const fc = { type: "FeatureCollection", name: "wikidata-memorials", features: deduped };
  const provenance = registryProvenance(FILE);
  if (provenance) fc.properties = provenance;
  else console.warn(`  WARNING no registered layer claims ${FILE}; provenance not stamped`);

  const bytes = writeJSON(`${OUT}/${FILE}`, fc);
  console.log(
    `  ${String(deduped.length).padStart(6)} features  ${String(Math.round(bytes / 1024)).padStart(6)} KB  ${FILE}`,
  );
}

run().catch((err) => {
  console.error("ingest-wikidata-memorials failed:", err.message);
  process.exit(1);
});
