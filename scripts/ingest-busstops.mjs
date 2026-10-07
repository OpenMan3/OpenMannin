/**
 * Bus stop ingestion from OpenStreetMap, with per-stop services from OSM route
 * relations.
 *
 * WHY OSM ONLY
 * ------------
 * This layer is built entirely from OpenStreetMap under the ODbL:
 *
 *   1. EVERY `highway=bus_stop` / `public_transport=platform` node in OSM with
 *      its name and ref. This is the full island coverage.
 *   2. Per-stop `services` from OSM `type=route`, `route=bus` relations whose
 *      stop members are the node. This is current but partial — only a minority
 *      of stops are members of such relations. Stops with no relation simply
 *      carry no services rather than inheriting an invented timetable.
 *
 * No official stop numbers or NaPTAN codes are joined: that data is not openly
 * licensed. Absence of it is reported in the layer caveats, not papered over.
 *
 *   node --experimental-strip-types scripts/ingest-busstops.mjs
 */

import { UA, writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/bus-stops.geojson";
const BBOX = "54.02,-4.85,54.45,-4.30"; // south, west, north, east

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function overpass(query, label) {
  const deadline = Date.now() + 240_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    for (const ep of OVERPASS) {
      if (Date.now() >= deadline) break;
      try {
        const res = await fetch(ep, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("non-JSON response (error page)");
        }
        if ((json.elements ?? []).length > 0) return json;
        throw new Error(`empty response for ${label} from ${ep}`);
      } catch (err) {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        console.log(`  ${label}: ${ep} failed (${err.message.slice(0, 70)}), ${left}s left`);
      }
    }
    if (Date.now() < deadline) {
      console.log(`  ${label}: attempt ${attempt} exhausted mirrors, retrying`);
      await sleep(4000);
    }
  }
  throw new Error(`overpass exhausted for ${label}`);
}

/** "2", "10a", "X3" sort like route numbers, not alphabetically. */
function naturalServiceSort(refs) {
  return [...refs].sort((a, b) => {
    const ma = String(a).match(/^(\d*)(.*)$/);
    const mb = String(b).match(/^(\d*)(.*)$/);
    const na = ma[1] === "" ? Infinity : Number(ma[1]);
    const nb = mb[1] === "" ? Infinity : Number(mb[1]);
    if (na !== nb) return na - nb;
    return String(ma[2]).localeCompare(String(mb[2]));
  });
}

async function main() {
  console.log("Bus stop ingest (OSM coverage + OSM route relations)");

  // 1. Every stop node with tags.
  const stopsBody = await overpass(
    `[out:json][timeout:120];
(
  node["highway"="bus_stop"](${BBOX});
  node["public_transport"="platform"]["bus"="yes"](${BBOX});
);
out body;`,
    "stops",
  );

  const stops = [];
  for (const el of stopsBody.elements ?? []) {
    if (el.lat === undefined || el.lon === undefined) continue;
    const t = el.tags ?? {};
    stops.push({
      id: `${el.type}/${el.id}`,
      kind:
        t["highway"] === "bus_stop" && t["public_transport"] === "platform"
          ? "stop+platform"
          : t["highway"] === "bus_stop"
            ? "stop"
            : "platform",
      name: t.name ?? t["name:en"] ?? t.ref ?? null,
      ref: t.ref ?? null,
      locality: t.locality ?? null,
      shelter: t.shelter ?? null,
      lon: el.lon,
      lat: el.lat,
    });
  }
  console.log(`  OSM stop nodes:        ${stops.length}`);

  // 2. Route relations -> node id -> route refs.
  const routesBody = await overpass(
    `[out:json][timeout:120];
rel["type"="route"]["route"="bus"](${BBOX});
out center;`,
    "routes",
  );
  const stopNodeIds = new Set(stopsBody.elements.map((e) => e.id));
  const servicesByNode = new Map();
  for (const rel of routesBody.elements ?? []) {
    const t = rel.tags ?? {};
    const ref = t.ref ?? t.name ?? null;
    if (!ref) continue;
    for (const m of rel.members ?? []) {
      // Route relations reference stops as bare node members (sometimes with
      // role "stop"/"platform", often with no role); way members are road
      // geometry, not stops.
      if (m.type === "node" && stopNodeIds.has(m.ref)) {
        const list = servicesByNode.get(m.ref) ?? new Set();
        list.add(ref);
        servicesByNode.set(m.ref, list);
      }
    }
  }
  console.log(`  stops served by OSM relations: ${servicesByNode.size}`);

  // 3. Deduplicate stops that share a location (a mapped platform node 5 m
  //    from the bus_stop node is the same stop).
  const merges = [];
  const merged = [];
  const keptSpots = [];
  for (const s of stops) {
    const near = keptSpots.filter(
      (k) => Math.abs(k.lat - s.lat) < 0.0004 && Math.abs(k.lon - s.lon) < 0.0004,
    );
    if (near.length) {
      const refs = servicesByNode.get(Number(s.id.split("/")[1]));
      if (refs && near[0].nodeId !== Number(s.id.split("/")[1])) {
        const keep = servicesByNode.get(near[0].nodeId) ?? new Set();
        for (const r of refs) keep.add(r);
        servicesByNode.set(near[0].nodeId, keep);
      }
      merges.push(s.id);
      continue;
    }
    keptSpots.push({ nodeId: Number(s.id.split("/")[1]), lat: s.lat, lon: s.lon });
    merged.push(s);
  }
  console.log(`  platform duplicates merged: ${merges.length} -> final ${merged.length}`);

  // 4. Assemble the FeatureCollection.
  const features = [];
  for (const s of merged) {
    const nodeId = Number(s.id.split("/")[1]);
    const serviceSet = servicesByNode.get(nodeId);
    const services = serviceSet ? naturalServiceSort(serviceSet) : [];
    features.push({
      type: "Feature",
      id: s.id,
      geometry: roundCoords({ type: "Point", coordinates: [s.lon, s.lat] }, 5),
      properties: {
        label: s.name ?? s.locality ?? "Unnamed stop",
        ref: s.ref ?? null,
        kind: s.kind,
        locality: s.locality,
        shelter: s.shelter,
        services: services.length ? services : null,
        serviceCount: services.length,
        source: "osm",
      },
    });
  }

  const withServices = features.filter((f) => (f.properties.services ?? []).length > 0).length;
  const missing = features.length - withServices;
  console.log(`  features with services: ${withServices} (no services on ${missing})`);

  const src = SOURCES.osmIOM;
  const fc = {
    type: "FeatureCollection",
    name: "bus-stops",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "osmIOM",
      sourceUrl: src.url,
      licence: "Open Database License (ODbL)",
      licenceId: "ODbL",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/",
      caveats: [
        "Per-stop services come only from OSM route relations, which are current but partial: most stops carry no service list rather than a guessed one. VERIFY against current timetables (iombusandrail.im) before relying on services.",
        "No official stop numbers or NaPTAN codes are shown; those identifiers come from government data that is not openly licensed and are not used here.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };
  const bytes = writeJSON(OUT, fc);
  console.log(`\nwrote ${OUT}: ${features.length} stops, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
