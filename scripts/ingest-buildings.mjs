/**
 * Overture Maps building footprints within the Isle of Man bbox.
 *
 * The buildings theme over the island is entirely ODbL-1.0 (OpenStreetMap and
 * Microsoft ML Buildings). The primary source is OpenStreetMap; Microsoft ML
 * roofprints fill in coverage. Unlike Overture Places, there is no
 * CDLA-Permissive-2.0 content here, so the licence gate is the buildings map,
 * which enforces ODbL attribution AND share-alike.
 *
 * The release is pinned in scripts/lib/overture-release.mjs.
 *
 * In addition to the Overture fields, this ingest pulls the OSM tag set for
 * every building in the island bbox via Overpass and merges it onto the
 * matching Overture record (by Overture's `sources[1].record_id`, which carries
 * the underlying OSM element id at `osm.*`). Named buildings therefore carry
 * the operator, address, heritage reference and purpose tags OpenStreetMap holds
 * instead of only Overture's lossy subset, and unnamed buildings keep their
 * Overture building class alongside the nearest-place context assigned later.
 *
 *   npm run ingest:buildings
 */
import { classifyBuildingRecord, summariseBuildingRecords } from "./lib/overture-buildings-licence.mjs";
import { OVERTURE_RELEASE } from "./lib/overture-release.mjs";
import { writeJSON, roundCoords, simplifyGeometry } from "./lib/fetch.mjs";
import { overpass } from "./lib/overpass.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/buildings.geojson";
const BBOX = { minLon: -4.85, maxLon: -4.30, minLat: 54.02, maxLat: 54.45 };
const SIMPLIFY_TOL = 0.00002;

const { DuckDBInstance } = await import("@duckdb/node-api");


function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function s(v) {
  if (v == null) return null;
  const x = String(v).trim();
  return x.length ? x : null;
}

function canonicalOsmId(v) {
  const m = /^([nwr])(\d+)(?:@.*)?$/.exec(String(v ?? "").trim());
  if (!m) return String(v ?? "").trim() || null;
  const type = { n: "node", w: "way", r: "relation" }[m[1]];
  if (!type) return null;
  return `${type}/${m[2]}`;
}

function firstPoint(geom) {
  let c = geom?.coordinates;
  for (let d = 0; d < 6 && Array.isArray(c); d++) {
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
    c = c[0];
  }
  return null;
}

/** Pull a purpose token from an OSM tag bag: the first meaningful kind tag. */
const PURPOSE_KEYS = ["amenity", "shop", "office", "craft", "tourism", "religion", "historic", "leisure", "emergency", "healthcare", "military", "government", "aeroway", "industrial", "power", "building"];
const PURPOSE_SKIP = new Set(["yes", "building", "house", "residential", "apartments", "hut", "shed", "roof", "service", "ruins", "static", null]);
function purposeFrom(tags) {
  for (const k of PURPOSE_KEYS) {
    const v = tags?.[k];
    if (v == null) continue;
    const x = String(v).trim().toLowerCase();
    if (!x || PURPOSE_SKIP.has(x)) continue;
    return x;
  }
  return null;
}

function mergeOsmTags(osm, core) {
  if (!osm) return core;
  const t = osm;
  if (!core.name && (t.name || t["name:en"] || t["loc_name"])) {
    core.name = s(t.name || t["name:en"] || t["loc_name"]);
  }
  if (t["addr:housename"]) core.housename = s(t["addr:housename"]);
  if (t["addr:housenumber"]) core.housenumber = s(t["addr:housenumber"]);
  if (t["addr:street"]) core.street = s(t["addr:street"]);
  if (t["addr:suburb"]) core.suburb = s(t["addr:suburb"]);
  if (t["addr:city"]) core.city = s(t["addr:city"]);
  if (t["addr:place"]) core.place = s(t["addr:place"]);
  if (t["addr:postcode"]) core.postcode = s(t["addr:postcode"]);
  if (t.operator) core.operator = s(t.operator);
  if (t.brand) core.brand = s(t.brand);
  if (t.wikidata) core.wikidata = s(t.wikidata);
  if (t["heritage:ref"]) core.heritageRef = s(t["heritage:ref"]);
  if (t["ref:registered_building"]) core.registeredBuildingRef = s(t["ref:registered_building"]);
  if (t["url:registered_building"]) core.registeredBuildingUrl = s(t["url:registered_building"]);
  if (t.architect) core.architect = s(t.architect);
  if (t["architect:wikidata"]) core.architectWikidata = s(t["architect:wikidata"]);
  if (t["start_date"]) core.builtYear = s(t["start_date"]);
  if (t["building:levels"]) core.levels = s(t["building:levels"]);
  if (t.height) core.osmHeight = num(t.height);
  const p = purposeFrom(t);
  if (p) core.purpose = p;
  if (!core.buildingClass && t.building && t.building !== "yes") core.buildingClass = String(t.building);
  if (t["building:material"]) core.buildingMaterial = s(t["building:material"]);
  if (t.alt_name) core.altName = s(t.alt_name);
  if (t["old_name"]) core.oldName = s(t["old_name"]);
  if (t.description) core.description = s(t.description);
  if (t.opening_hours) core.openingHours = s(t.opening_hours);
  if (t.website) core.website = s(t.website);
  if (t["contact:phone"]) core.phone = s(t["contact:phone"]);
  if (t["contact:email"]) core.email = s(t["contact:email"]);
  if (t.source) core.buildingSource = s(t.source);
  core.enrichedBy = "osm-overpass";
  return core;
}

async function loadToponyms() {
  try {
    const g = JSON.parse(require("node:fs").readFileSync("public/data/toponyms.geojson", "utf8"));
    const pts = [];
    for (const f of g.features ?? []) {
      const c = firstPoint(f.geometry);
      if (f.properties?.name && c) pts.push({ name: String(f.properties.name), lon: c[0], lat: c[1] });
    }
    return pts;
  } catch {
    return [];
  }
}
// We'll import fs via node:fs at runtime instead to avoid ESM dependency foot-gun:
// (loadToponyms filled later)

async function findOsmMatches(featuresWithGeom) {
  // Single Overpass call with all `nwr["building"]` on the island, tags + center only.
  console.log("  querying Overpass for all IoM buildings (+tags) ...");
  const body = await overpass(
    `[out:json][timeout:300];
(
  nwr["building"](54.02,-4.85,54.45,-4.30);
);
out tags center;`,
    "iom-buildings",
  );
  const map = new Map();
  const els = body.elements ?? [];
  console.log(`  Overpass returned ${els.length} building elements`);
  for (const el of els) {
    const id = `${el.type}/${el.id}`;
    const t = el.tags ?? {};
    if (Object.keys(t).length === 0) continue;
    map.set(id, t);
  }
  return map;
}

async function run() {
  const fs = await import("node:fs");
  const coreRead = (u) => JSON.parse(fs.default.readFileSync(new URL(u, import.meta.url), "utf8"));

  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await conn.run("INSTALL spatial; LOAD spatial;");
  await conn.run("SET s3_region='us-west-2';");

  const release = OVERTURE_RELEASE;
  console.log(`Overture buildings ingest (pinned release ${release})`);

  const query = `
    SELECT
      id,
      names.primary AS name,
      class AS buildingClass,
      subtype AS subtype,
      height AS height,
      sources[1].dataset AS sourceDataset,
      sources[1].license AS sourceLicense,
      sources[1].record_id AS osmId,
      ST_AsGeoJSON(geometry) AS geometry
    FROM read_parquet('s3://overturemaps-us-west-2/release/' || ? || '/theme=buildings/type=building/*')
    WHERE bbox.xmin > ? AND bbox.xmax < ?
      AND bbox.ymin > ? AND bbox.ymax < ?
  `;
  const rows = await conn.runAndReadAll(query, [
    release,
    BBOX.minLon,
    BBOX.maxLon,
    BBOX.minLat,
    BBOX.maxLat,
  ]);

  const parsedRows = rows.getRowObjects();
  const featureRecords = [];
  for (const row of parsedRows) {
    let geometry;
    if (!row.geometry) { continue; }
    try {
      geometry = JSON.parse(row.geometry);
    } catch {
      console.warn(`  skip ${row.id}: bad geometry`);
      continue;
    }
    if (!geometry) continue;
    featureRecords.push({ row, geometry });
  }

  const summary = summariseBuildingRecords(featureRecords.map(({ row }) => ({
    sourceDataset: row.sourceDataset,
    sourceLicense: row.sourceLicense,
  })));

  const osmMatches = await findOsmMatches();
  console.log(`  osm tag matches loaded: ${osmMatches.size}`);

  const features = [];
  let enrichedCount = 0;
  for (const { row, geometry } of featureRecords) {
    const decision = classifyBuildingRecord(row.sourceDataset, row.sourceLicense);
    if (decision.action !== "keep") continue;
    const simplified = simplifyGeometry(geometry, SIMPLIFY_TOL);
    if (!simplified) continue;
    const osmId = s(row.osmId);
    const canonical = osmId ? canonicalOsmId(osmId) : null;
    const matchKey = canonical && osmMatches.has(canonical) ? canonical : null;
    const osmTags = matchKey ? osmMatches.get(matchKey) : null;
    const props = {
      name: row.name ?? null,
      buildingClass: row.buildingClass ?? null,
      subtype: row.subtype ?? null,
      purpose: row.subtype ?? null,
      height: typeof row.height === "number" ? Math.round(row.height * 10) / 10 : row.height ?? null,
      sourceDataset: row.sourceDataset,
      osmId: osmId,
    };
    if (osmTags) {
      mergeOsmTags(osmTags, props);
      enrichedCount++;
    }
    // if still unnamed, ensure purpose defaults to buildingClass/subtype or null
    if (!props.purpose) {
      if (typeof props.buildingClass === "string" && props.buildingClass) props.purpose = String(props.buildingClass).toLowerCase();
      else if (typeof props.subtype === "string" && props.subtype) props.purpose = String(props.subtype).toLowerCase();
      else props.purpose = null;
    }
    // A deliberate gap here: some roofprints only exist in the aerial layer and
    // carry no OSM name or kind. They are kept on the map but deliberately do
    // not receive a generic "Building" identity; feature-label derives context
    // from the osmId. scripts/enrich-buildings-names.mjs may add real names.
    // named buildings: prefer purpose from kind tags but leave (already set if tags)
    features.push({
      type: "Feature",
      id: row.id,
      geometry: roundCoords(simplified, 5),
      properties: props,
    });
  }

  if (features.length === 0) {
    console.error("FAIL — no Overture building records survived the licence filter");
    process.exit(1);
  }

  console.log(`  records in bbox:   ${parsedRows.length}`);
  console.log(`  records parsed:    ${featureRecords.length}`);
  console.log(`  kept (ODbL):       ${summary.kept}`);
  console.log(`  excluded:          ${summary.excluded}`);
  for (const [key, value] of summary.excludedCounts) console.log(`    ${key}: ${value}`);
  console.log(`  enriched from OSM: ${enrichedCount} / ${features.length} (${Math.round(enrichedCount/features.length*100)}%)`);

  const namedCount = features.filter((f) => f.properties.name).length;
  console.log(`  named buildings:   ${namedCount} (${Math.round(namedCount/features.length*100)}%)`);
  const purposeCount = features.filter((f) => f.properties.purpose).length;
  console.log(`  have purpose:       ${purposeCount} (${Math.round(purposeCount / features.length * 100)}%)`);

  const src = SOURCES.overtureBuildings;
  const featureCollection = {
    type: "FeatureCollection",
    name: "buildings",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "overtureBuildings",
      sourceUrl: src.url,
      licence: "ODbL-1.0",
      licenceId: "ODbL",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/",
      release,
      bbox: [BBOX.minLon, BBOX.minLat, BBOX.maxLon, BBOX.maxLat],
      caveats: [
        "Overture buildings theme. The primary contributor is OpenStreetMap (ODbL); remaining coverage is Microsoft ML roofprints (ODbL) derived from aerial imagery.",
        "Enriched from OpenStreetMap's own building tags via Overpass (operator, address, heritage, purpose), merged by OSM element id. Enrichment therefore remains ODbL.",
        "ML-derived footprints are indicative, not survey-grade, and heights (where present) are modelled rather than measured.",
        "ODbL requires attribution AND share-alike on derived databases: (c) OpenStreetMap contributors and the Overture Maps contributors, ODbL.",
        "Not an official building register and not a proxy for addresses, occupancy or planning status.",
      ],
    },
    features,
  };

  const bytes = writeJSON(OUT, featureCollection, { pretty: false });
  console.log(`\\nwrote ${OUT}: ${features.length} features, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

await run();
