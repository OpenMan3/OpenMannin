/**
 * Communication towers, masts and antenna sites from OpenStreetMap.
 *
 * WHY OSM ONLY
 * ------------
 * No operator publishes its mast register as open data for the Isle of Man, so
 * OpenStreetMap is the only open route. Manx Telecom's own named sites (e.g.
 * the CARNANE1 tower beside the SpaceMan teleport) are mapped as OSM features
 * rather than joined from a private asset list.
 *
 *   node --experimental-strip-types scripts/ingest-comms-towers.mjs
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX } from "./lib/overpass.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/comms-towers.geojson";

const QUERY = `[out:json][timeout:120];
(
  node["man_made"~"^(tower|mast|communications_tower)$"](${IOM_BBOX});
  way["man_made"~"^(tower|mast|communications_tower)$"](${IOM_BBOX});
  node["tower:type"="communication"](${IOM_BBOX});
  way["tower:type"="communication"](${IOM_BBOX});
);
out center tags;`;

async function main() {
  console.log("Comms towers ingest (OSM man_made + tower:type=communication)");
  const body = await overpass(QUERY, "comms towers");

  const features = [];
  const seen = new Set();
  for (const el of body.elements ?? []) {
    // `out center` puts a centre on ways; bare nodes carry lat/lon themselves.
    const lon = el.lon ?? el.center?.lon;
    const lat = el.lat ?? el.center?.lat;
    if (lon === undefined || lat === undefined) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = el.tags ?? {};
    features.push({
      type: "Feature",
      id,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 5),
      properties: {
        name: t.name ?? null,
        man_made: t.man_made ?? null,
        towerType: t["tower:type"] ?? null,
        operator: t.operator ?? null,
        height: t.height ?? null,
        source: "osm",
      },
    });
  }
  console.log(`  OSM tower/mast features: ${features.length}`);

  const src = SOURCES.osmIOM;
  const fc = {
    type: "FeatureCollection",
    name: "comms-towers",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "osmIOM",
      sourceUrl: src.url,
      licence: "Open Database License (ODbL)",
      licenceId: "ODbL",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/",
      caveats: [
        "OSM community mapping, not the operators' asset register. Sites present on the ground may be unmapped, and mapped sites may be decommissioned.",
        "A mast is not proof of a live transmitter: OSM records its existence, not its operational state.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };
  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`\nwrote ${OUT}: ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
