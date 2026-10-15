/**
 * Overture Maps places within the Isle of Man bbox.
 *
 * The release is pinned in scripts/lib/overture-release.mjs; see scripts/lib/overture-release.test.mjs.
 *
 *   npm run ingest:overture
 */

import { classifyOvertureRecord, summariseOvertureRecords } from "./lib/overture-licence.mjs";
import { OVERTURE_RELEASE } from "./lib/overture-release.mjs";
import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/overture-places.geojson";
const BBOX = { minLon: -4.85, maxLon: -4.30, minLat: 54.02, maxLat: 54.45 };

const { DuckDBInstance } = await import("@duckdb/node-api");

async function main() {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await conn.run("INSTALL httpfs; LOAD httpfs;");
  await conn.run("INSTALL spatial; LOAD spatial;");
  await conn.run("SET s3_region='us-west-2';");

  const release = OVERTURE_RELEASE;
  console.log(`Overture ingest (pinned release ${release})`);

  const query = `
    SELECT
      id,
      names.primary AS name,
      taxonomy.primary AS category,
      basic_category AS basicCategory,
      addresses[1].freeform AS address,
      confidence AS confidence,
      sources[1].dataset AS sourceDataset,
      sources[1].license AS sourceLicense,
      ST_AsGeoJSON(geometry) AS geometry
    FROM read_parquet('s3://overturemaps-us-west-2/release/' || ? || '/theme=places/type=place/*')
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

  // Hard licence gate: unknown contributor/licence pairs fail here.
  const summary = summariseOvertureRecords(featureRecords.map(({ row }) => ({
    sourceDataset: row.sourceDataset,
    sourceLicense: row.sourceLicense,
  })));

  const features = [];
  for (const { row, geometry } of featureRecords) {
    const decision = classifyOvertureRecord(row.sourceDataset, row.sourceLicense);
    if (decision.action !== "keep") continue;
    if (!row.sourceDataset || row.sourceDataset.trim() === "") {
      throw new Error(`record ${row.id} carries CDLA-Permissive-2.0 with no source dataset`);
    }
    features.push({
      type: "Feature",
      id: row.id,
      geometry: roundCoords(geometry, 5),
      properties: {
        id: row.id,
        name: row.name ?? null,
        category: row.category ?? null,
        basicCategory: row.basicCategory ?? null,
        address: row.address ?? null,
        confidence: typeof row.confidence === "number" ? Math.round(row.confidence * 1000) / 1000 : row.confidence,
        sourceDataset: row.sourceDataset,
        originLicence: row.sourceLicense,
        source: "overture",
      },
    });
  }

  if (features.length === 0) {
    console.error("FAIL — no Overture records survived the licence filter");
    process.exit(1);
  }

  console.log(`  records in bbox:   ${parsedRows.length}`);
  console.log(`  records parsed:    ${featureRecords.length}`);
  console.log(`  kept (CDLA):       ${summary.kept}`);
  console.log(`  excluded:          ${summary.excluded}`);
  for (const [key, value] of summary.excludedCounts) console.log(`    ${key}: ${value}`);

  const uniqueContributors = new Set(features.map((feature) => feature.properties.sourceDataset));
  for (const contributor of uniqueContributors) {
    if (!contributor || contributor.trim() === "") throw new Error("empty contributor in kept records");
  }

  const src = SOURCES.overturePlaces;
  const featureCollection = {
    type: "FeatureCollection",
    name: "overture-places",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "overturePlaces",
      sourceUrl: src.url,
      licence: "CDLA-Permissive-2.0",
      licenceId: "CDLA-PERMISSIVE-2.0",
      licenceUrl: "https://cdla.dev/permissive-2-0/",
      release,
      bbox: [BBOX.minLon, BBOX.minLat, BBOX.maxLon, BBOX.maxLat],
      caveats: [
        "Overture release data. Coverage varies wildly by contributor and geography; names, addresses and categories are not verified.",
        "Only records whose primary contributor declares CDLA-Permissive-2.0 are present. Apache-2.0 and CC0 contributors are deliberately excluded.",
        "Not an official register. Do not use for emergency service, legal or commercial targeting decisions.",
        "Attribution required: Overture release contributors under CDLA-Permissive-2.0; per record sourceDataset documents the originator.",
      ],
    },
    features,
  };

  const bytes = writeJSON(OUT, featureCollection, { pretty: true });
  console.log(`\nwrote ${OUT}: ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
}

await main();
