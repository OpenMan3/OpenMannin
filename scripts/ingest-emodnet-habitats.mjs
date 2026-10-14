/**
 * EMODnet Seabed Habitats — biogenic substrate around the Isle of Man.
 *
 * Source: the EMODnet Seabed Habitats WFS (geoserver workspace "emodnet_view"),
 * two layers from the 2025 biogenic-substrate product:
 *   - biogenic_substrate_points_2025  (survey records: Modiolus, maerl, etc.)
 *   - biogenic_substrate_poly_2025    (mapped bed extents)
 *
 * Both are published in EPSG:3857 and the polygon layer ships whole
 * MultiPolygons that aggregate beds across the NE Atlantic, so WFS bbox
 * filtering alone returns geometry reaching 45 N / 35 E. We ask the server for
 * WGS84 (srsName=EPSG:4326) and clip the polygons to the island bbox ourselves.
 *
 * Licence is CC-BY 4.0. Attribution is per-product: every feature keeps the
 * originating survey in `sourceDataset`, which must be credited alongside
 * EMODnet.
 *
 *   npm run ingest:habitats
 */

import { getJson, writeJSON, roundCoords } from "./lib/fetch.mjs";
import { clipGeometry } from "./lib/geo-clip.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/marine-habitats.geojson";
const WFS = "https://ows.emodnet-seabedhabitats.eu/geoserver/emodnet_view/wfs";
const BBOX = [-4.9, 54.0, -4.2, 54.45]; // [minX, minY, maxX, maxY]
const NS = "emodnet_view";

async function fetchLayer(typeName) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `${NS}:${typeName}`,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    // CRS84 keeps the bbox axis order lon,lat regardless of the layer's native
    // EPSG:3857. srsName above reprojects the returned coordinates to WGS84.
    bbox: `${BBOX[0]},${BBOX[1]},${BBOX[2]},${BBOX[3]},urn:ogc:def:crs:OGC:1.3:CRS84`,
  });
  // The points layer's spatial filter is a slow full scan upstream (60-150 s)
  // even for a handful of matches, so allow well over the default timeout.
  const fc = await getJson(`${WFS}?${params}`, { timeoutMs: 240_000, retries: 2 });
  if (!fc || fc.type !== "FeatureCollection") {
    throw new Error(`${typeName}: WFS did not return a FeatureCollection`);
  }
  return fc;
}

function makeFeature(sourceId, geometry, props) {
  return {
    type: "Feature",
    id: sourceId,
    geometry: roundCoords(geometry, 5),
    properties: {
      habitat: props.bio_detail ?? null,
      habitatDetail: props.habitat ?? null,
      sourceDataset: props.src_name ?? null,
      origin: "EMODnet Seabed Habitats",
    },
  };
}

async function main() {
  console.log("EMODnet Seabed Habitats ingest (biogenic substrate 2025)");

  const points = await fetchLayer("biogenic_substrate_points_2025");
  const polys = await fetchLayer("biogenic_substrate_poly_2025");
  console.log(`  points matched:      ${points.numberMatched ?? points.features.length}`);
  console.log(`  polygons matched:    ${polys.numberMatched ?? polys.features.length}`);

  const features = [];
  const pointOnly = points.features.filter(
    (f) => Array.isArray(f.geometry?.coordinates) &&
      f.geometry.coordinates[0] >= BBOX[0] && f.geometry.coordinates[0] <= BBOX[2] &&
      f.geometry.coordinates[1] >= BBOX[1] && f.geometry.coordinates[1] <= BBOX[3],
  );
  for (const f of pointOnly) features.push(makeFeature(f.id, f.geometry, f.properties));
  console.log(`  point records kept:  ${pointOnly.length}`);

  let keptPolys = 0;
  let dropped = 0;
  for (const f of polys.features) {
    const clipped = clipGeometry(f.geometry, BBOX);
    if (!clipped) {
      dropped += 1;
      continue;
    }
    features.push(makeFeature(f.id, clipped, f.properties));
    keptPolys += 1;
  }
  console.log(`  bed extents kept:    ${keptPolys} (${dropped} clipped away entirely)`);

  if (features.length === 0) {
    console.error("FAIL — no EMODnet habitat records survived the IoM clip");
    process.exit(1);
  }

  const src = SOURCES.emodnetHabitats;
  const fc = {
    type: "FeatureCollection",
    name: "marine-habitats",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "emodnetHabitats",
      sourceUrl: src.url,
      licence: "CC-BY-4.0",
      licenceId: "CC-BY-4.0",
      licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
      bbox: BBOX,
      caveats: [
        "Presence-only. A record means habitat was mapped or sampled there; an empty area means no survey data, NOT absence of habitat.",
        "CC-BY 4.0: attribute both EMODnet Seabed Habitats and the originating survey recorded per feature in sourceDataset.",
        "Bed extents are clipped to an island bounding box, not to Manx territorial waters or any legal boundary.",
        "Compiled by EMODnet from many surveys of differing age, method and resolution. Indicative only; not for navigation, fisheries management or marine licensing.",
      ],
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: false });
  console.log(`\nwrote ${OUT}: ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
}

await main();
