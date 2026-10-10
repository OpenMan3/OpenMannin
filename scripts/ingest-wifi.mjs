/**
 * Places mapped as offering WiFi access in OpenStreetMap.
 *
 * WHY OSM ONLY
 * ------------
 * There is no open public register of WiFi hotspots on the Isle of Man. OSM's
 * `internet_access=wlan` / `amenity=wifi` tags are the only open signal, and
 * they are thin: most hits are venues (cafes, pubs, hotels) that merely have
 * WiFi, not verified public hotspots. Coverage is partial and largely self-
 * reported at the point a mapper visited.
 *
 *   node --experimental-strip-types scripts/ingest-wifi.mjs
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX } from "./lib/overpass.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/wifi.geojson";

const QUERY = `[out:json][timeout:120];
(
  node["internet_access"~"^(wlan|yes|wifi|free|permissive)$"](${IOM_BBOX});
  way["internet_access"~"^(wlan|yes|wifi|free|permissive)$"](${IOM_BBOX});
  node["amenity"="wifi"](${IOM_BBOX});
  way["amenity"="wifi"](${IOM_BBOX});
);
out center tags;`;

async function main() {
  console.log("WiFi-access ingest (OSM internet_access=wlan / amenity=wifi)");
  const body = await overpass(QUERY, "wifi access");

  const features = [];
  const seen = new Set();
  for (const el of body.elements ?? []) {
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
        amenity: t.amenity ?? null,
        operator: t.operator ?? t.brand ?? null,
        internet_access: t.internet_access ?? null,
        access: t.access ?? null,
        fee: t.fee ?? null,
        source: "osm",
      },
    });
  }
  console.log(`  OSM wifi-access features: ${features.length}`);

  const src = SOURCES.osmIOM;
  const fc = {
    type: "FeatureCollection",
    name: "wifi",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "osmIOM",
      sourceUrl: src.url,
      licence: "Open Database License (ODbL)",
      licenceId: "ODbL",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/",
      caveats: [
        "OSM self-reported, community-maintained coverage. A mapped WiFi tag means a mapper once recorded access here — it does not prove the network is live today.",
        "Most features are venues (cafes, pubs, hotels) whose own WiFi happens to be tagged, not municipal public hotspots.",
        "No official public-WiFi hotspot register is published as open data for the Isle of Man.",
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
