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
 *   npm run ingest:buildings
 */

import { classifyBuildingRecord, summariseBuildingRecords } from "./lib/overture-buildings-licence.mjs";
import { OVERTURE_RELEASE } from "./lib/overture-release.mjs";
import { writeJSON, roundCoords, simplifyGeometry } from "./lib/fetch.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/buildings.geojson";
const BBOX = { minLon: -4.85, maxLon: -4.30, minLat: 54.02, maxLat: 54.45 };
// ~2.2 m. Buildings are tens of metres across and the map tops out well below
// the zoom where 2 m of ring detail would be visible, but full vertex density
// keeps the fallback GeoJSON near 46 MB. This trims it without visible change.
const SIMPLIFY_TOL = 0.00002;

const { DuckDBInstance } = await import("@duckdb/node-api");

async function main() {
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

  const features = [];
  for (const { row, geometry } of featureRecords) {
    const decision = classifyBuildingRecord(row.sourceDataset, row.sourceLicense);
    if (decision.action !== "keep") continue;
    const simplified = simplifyGeometry(geometry, SIMPLIFY_TOL);
    if (!simplified) continue;
    features.push({
      type: "Feature",
      id: row.id,
      geometry: roundCoords(simplified, 5),
      properties: {
        name: row.name ?? null,
        buildingClass: row.buildingClass ?? null,
        subtype: row.subtype ?? null,
        height: typeof row.height === "number" ? Math.round(row.height * 10) / 10 : row.height ?? null,
        sourceDataset: row.sourceDataset,
      },
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
        "ML-derived footprints are indicative, not survey-grade, and heights (where present) are modelled rather than measured.",
        "ODbL requires attribution AND share-alike on derived databases: (c) OpenStreetMap contributors and the Overture Maps contributors, ODbL.",
        "Not an official building register and not a proxy for addresses, occupancy or planning status.",
      ],
    },
    features,
  };

  const bytes = writeJSON(OUT, featureCollection, { pretty: false });
  console.log(`\nwrote ${OUT}: ${features.length} features, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

await main();
