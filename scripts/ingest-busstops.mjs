/**
 * Bus stop ingestion: full island coverage from OpenStreetMap, enriched with
 * official identifiers and per-stop services.
 *
 * WHY NOT MANNGIS ALONE
 * ---------------------
 * The MANNGIS "Bus Stops" layer carries only 215 stops. The Bus Vannin network
 * serves 850+ (the timetable Excel datasets reference that many, and OSM has
 * mapped over 900 on the island). Half the island's stops are simply absent
 * from the official layer, and the MANNGIS data has no route information at
 * all - there is no field saying which services call here. It also hosts only
 * official stop numbers and NaPTAN codes, which are the genuinely valuable
 * part. So this file merges:
 *
 *   1. EVERY `highway=bus_stop` / `public_transport=platform` node in OSM,
 *      with its name. This is the coverage the map was missing.
 *   2. MANNGIS stop numbers (5-digit, e.g. 00101) and NaPTAN codes (891...)
 *      joined onto the OSM stop that carries the same `ref` tag, else the
 *      nearest one within walking distance. OSM nodes almost all carry the
 *      same 5-digit `ref`, so the join is exact for the overlap.
 *   3. Per-stop `services` collected two ways and deduped:
 *        - route relations (type=route, route=bus) whose stop members are this
 *          node — current, but only 44 stops are members of such relations;
 *        - a spatial join against the site's own bus-routes layer, which is a
 *          documented 2015 network. This fills the other 800+ stops.
 *      The routes layer carries the caveat that it is the October 2015
 *      network; services derived from it inherit that age and the layer
 *      caveats say so explicitly. Do not present them as today's timetable.
 *
 * Why static? Same reason as ingest-manngis: bake at build time, do not
 * hammer Overpass or the government's ArcGIS from the client.
 *
 *   node --experimental-strip-types scripts/ingest-busstops.mjs
 */

import fs from "node:fs";
import { UA, writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/bus-stops.geojson";
const ROUTES_FILE = "public/data/bus-routes.geojson";
const BBOX = "54.02,-4.85,54.45,-4.30"; // same as ingest-osm: south, west, north, east

// Overpass mirrors, same order as ingest-osm. overpass-api.de is chronically
// overloaded and answers "open64" runtime errors under load, so each query is
// retried several times across all mirrors before giving up.
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

async function overpass(query, label) {
  // Overpass-api.de is the live instance right now (kumi.systems hangs and the
  // mail.ru mirror 504s). It answers "open64" runtime errors under load, so the
  // query is retried with a short per-req timeout until a deadline. Fail LOUDLY
  // on deadline: a missing stop list must never be written as an empty file.
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

/** Haversine metres between two lon/lat points. */
function metres([lon1, lat1], [lon2, lat2]) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Distance in metres from a lon/lat point to a LineString/MultiLineString. */
function metresToLine(point, coords) {
  const [px, py] = point;
  const isSingle = Array.isArray(coords[0]) && typeof coords[0][0] === "number";
  const lines = isSingle ? [coords] : coords;
  let best = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      // Projection onto segment in equirectangular space (fine at ~54°N).
      const ab = [bx - ax, by - ay];
      const len2 = ab[0] ** 2 + ab[1] ** 2;
      let t = len2 === 0 ? 0 : ((px - ax) * ab[0] + (py - ay) * ab[1]) / len2;
      t = Math.max(0, Math.min(1, t));
      const cp = [ax + t * ab[0], ay + t * ab[1]];
      const d = Math.hypot(
        (px - cp[0]) * 111320,
        (py - cp[1]) * Math.cos((py * Math.PI) / 180) * 111320,
      );
      if (d < best) best = d;
    }
  }
  return best;
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
  console.log("Bus stop ingest (OSM full coverage + MANNGIS ids + service join)");

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
      kind: t["highway"] === "bus_stop" && t["public_transport"] === "platform" ? "stop+platform" : (t["highway"] === "bus_stop" ? "stop" : "platform"),
      name: t.name ?? t["name:en"] ?? t.ref ?? null,
      ref: t.ref ?? null,
      locality: t.locality ?? null,
      shelter: t.shelter ?? null,
      lon: el.lon,
      lat: el.lat,
    });
  }
  console.log(`  OSM stop nodes:        ${stops.length}`);

  // 2. Route relations -> node id -> route refs (named and numbered).
  const routesBody = await overpass(
    `[out:json][timeout:120];
rel["type"="route"]["route"="bus"](${BBOX});
out center;`,
    "routes",
  );
  const stopNodeIds = new Set(stopsBody.elements.map((e) => e.id));
  const servicesByNode = new Map();
  const relationServices = new Map();
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
        const rl = relationServices.get(m.ref) ?? new Set();
        rl.add(ref);
        relationServices.set(m.ref, rl);
      }
    }
  }
  const relationServedStops = relationServices.size;
  console.log(`  stops served by OSM relations: ${relationServedStops}`);

  // 3. MANNGIS stop numbers + NaPTAN, joined on the shared 5-digit ref, else
  //    nearest stop within 150 m.
  let manngis;
  try {
    manngis = JSON.parse(fs.readFileSync("public/data/bus-stops.geojson", "utf8"));
  } catch {
    manngis = { features: [] };
  }
  const manngisByRef = new Map();
  const manngisList = [];
  for (const f of manngis.features ?? []) {
    const p = f.properties ?? {};
    const ref = String(p.stopNo ?? p.ref ?? "").replace(/^0+/, "");
    if (ref) manngisByRef.set(ref, p);
    const c = f.geometry?.coordinates;
    if (c) manngisList.push({ p, c });
  }
  let joinedExact = 0;
  let joinedNear = 0;
  for (const s of stops) {
    let official = null;
    const refKey = s.ref?.replace(/^0+/, "") ?? "";
    if (refKey && manngisByRef.has(refKey)) {
      official = manngisByRef.get(refKey);
      joinedExact++;
    } else {
      let best = null;
      let bestD = 150;
      for (const { p, c } of manngisList) {
        const d = metres([s.lon, s.lat], c);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) {
        official = best;
        joinedNear++;
      }
    }
    // Strip zero padding for JOIN keys only: the MANNGIS stop numbers are
    // 5-digit zero-padded ("00101") and the OSM refs carry the same padding.
    if (official) {
      s.naptan = official.naptan ?? null;
      s.stopNo = s.stopNo ?? official.stopNo ?? official.ref ?? null;
    }
  }
  console.log(`  MANNGIS ids joined:    ${joinedExact} exact (ref) + ${joinedNear} nearest`);

  // 4. Spatial join against bus-routes (documented 2015 network) for services
  //    on the stops OSM relations do not cover.
  let routesFC;
  try {
    routesFC = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf8"));
  } catch {
    routesFC = { features: [] };
  }
  const routeLines = [];
  for (const f of routesFC.features ?? []) {
    const route = String(f.properties?.route ?? "").trim();
    const g = f.geometry;
    if (!route || (g?.type !== "LineString" && g?.type !== "MultiLineString")) continue;
    if (!g.coordinates?.length) continue;
    routeLines.push({ route, coords: g.coordinates });
  }
  console.log(`  bus-route polylines:   ${routeLines.length}`);
  let routeServedStops = 0;
  let routeServiceAssignments = 0;
  for (const s of stops) {
    const nodeId = Number(s.id.split("/")[1]);
    if (relationServices.has(nodeId)) continue; // relations already cover it
    const point = [s.lon, s.lat];
    const near = new Set();
    for (const rl of routeLines) {
      // 120 m: close enough to the road a stop actually sits on, far enough
      // that the adjacent grid in Douglas does not smear every route into
      // every stop. Under-reporting beats inventing services.
      if (metresToLine(point, rl.coords) <= 120) near.add(rl.route);
    }
    if (near.size) {
      const list = servicesByNode.get(nodeId) ?? new Set();
      for (const r of near) list.add(r);
      servicesByNode.set(nodeId, list);
      routeServedStops++;
      routeServiceAssignments += near.size;
    }
  }
  console.log(`  stops given services by the 2015 route join: ${routeServedStops} (${routeServiceAssignments} assignments)`);

  // 5. Deduplicate stops that share a location (a mapped platform node 5 m
  //    from the bus_stop node is the same stop). Prefer the named "stop".
  const merges = [];
  const merged = [];
  const keptSpots = [];
  for (const s of stops) {
    const near = keptSpots.filter(
      (k) => Math.abs(k.lat - s.lat) < 0.0004 && Math.abs(k.lon - s.lon) < 0.0004,
    );
    if (near.length) {
      // Absorb a platform's route attribution into the kept stop.
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

  // 6. Assemble the FeatureCollection.
  const features = [];
  for (const s of merged) {
    const nodeId = Number(s.id.split("/")[1]);
    const serviceSet = servicesByNode.get(nodeId);
    const services = serviceSet ? naturalServiceSort(serviceSet) : [];
    const properties = {
      label: s.name ?? s.locality ?? "Unnamed stop",
      ref: s.ref ?? null,
      kind: s.kind,
      locality: s.locality,
      shelter: s.shelter,
      services: services.length ? services : null,
      serviceCount: services.length,
      source: s.name ? "osm" : "osm-unnamed",
    };
    if (s.stopNo !== undefined) properties.stopNo = s.stopNo;
    if (s.naptan) properties.naptan = s.naptan;
    features.push({
      type: "Feature",
      id: s.id,
      geometry: roundCoords({ type: "Point", coordinates: [s.lon, s.lat] }, 5),
      properties,
    });
  }

  const withServices = features.filter((f) => (f.properties.services ?? []).length > 0).length;
  const withOfficialIds = features.filter((f) => f.properties.naptan || f.properties.stopNo).length;
  console.log(`  features with services: ${withServices}`);
  console.log(`  features with official ids: ${withOfficialIds}`);

  const fc = {
    type: "FeatureCollection",
    name: "bus-stops",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors (+ MANNGIS Bus Stops official ids, + bus-routes service join)",
      licence: "ODbL",
      caveats: [
        "Per-stop services are a best-effort merge: OSM route relations where they exist (current but partial), otherwise a spatial join against the site's own bus-routes layer, which is a DOCUMENTED 2015 network. Route numbers change less often than timetables, but VERIFY against current timetables (iombusandrail.im) before relying on services.",
        "Official stop numbers and NaPTAN codes are matched from the MANNGIS Bus Stops layer (© IoM Government, OGL — derived) where a stop carries the same ref or is within 150 m; stops beyond that carry only OSM identifiers.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };
  const bytes = writeJSON(OUT, fc);
  const missing = features.filter((f) => (f.properties.services ?? []).length === 0).length;
  console.log(
    `\nwrote ${OUT}: ${features.length} stops, ${bytes / 1024} KB, ` +
      `services on ${withServices}, official ids on ${withOfficialIds}, no services on ${missing}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});