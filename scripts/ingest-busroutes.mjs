/**
 * Bus route alignment ingestion from OpenStreetMap route relations.
 *
 * WHY OSM ROUTE RELATIONS
 * -----------------------
 * Bus Vannin's current official network is not published as open, reusable
 * geometry (see the `bus-route-alignments` gap entry), and the 2015 government
 * network the old layer carried is not open-licensed either. OpenStreetMap is
 * the only source we can ship: its `type=route` `route=bus` relations hold the
 * member ways that make up each service, under the ODbL. One feature is emitted
 * per relation, carrying only tags the relation actually holds — nothing is
 * inferred, guessed or joined from a timetable.
 *
 * WHY bus AND coach
 * -----------------
 * The brief for a bus network is `route=bus`; `route=coach` was considered
 * because a long-distance or seasonal service could legitimately be tagged that
 * way. A bbox query for `route~"^(bus|coach)$"` on 2026-10-16 returned 69 bus
 * relations and ZERO coach relations, so including coach changes nothing today
 * but keeps a coach relation from being silently dropped if one is mapped. The
 * matched `route` value is written to each feature, so the two are never
 * conflated.
 *
 * WHY STITCH, AND WHY A MultiLineString FALLBACK
 * ----------------------------------------------
 * A route relation's geometry is the ordered list of its way members, each with
 * role ""/"forward"/"backward"; members with role "stop"/"platform" are stop
 * features, not alignment, and are ignored. Member ways are chained end-to-end
 * by endpoint matching (6 dp) exactly as the parish ingest reconstructs rings.
 * Some relations do not form one connected chain — branches, a loop with a
 * tail, or a member set longer than a single path can cover — and forcing them
 * into one LineString would invent a connection that is not in the data. Those
 * fall back to a MultiLineString of the chains that were actually found, and
 * the count is reported, rather than being silently mangled.
 *
 *   node --experimental-strip-types scripts/ingest-busroutes.mjs
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { overpass, IOM_BBOX as BBOX } from "./lib/overpass.mjs";
import { SOURCES } from "../src/lib/sources.ts";

const OUT = "public/data/bus-routes.geojson";

/** Member roles that carry route alignment; everything else is a feature. */
const GEOMETRY_ROLES = new Set(["", "forward", "backward"]);

/** Round a [lon,lat] position to the matching key used to join way endpoints. */
const posKey = (p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`;

/**
 * Chain an ordered list of way-member geometries into one or more polylines.
 *
 * `members` is [{coords: [[lon,lat], ...]}] in relation member order. Returns
 * an array of coordinate arrays; more than one means the members did not form a
 * single connected path (the caller emits a MultiLineString).
 */
function stitchWays(members) {
  const byKey = new Map();
  const addTo = (k, v) => {
    const list = byKey.get(k);
    if (list) list.push(v);
    else byKey.set(k, [v]);
  };
  members.forEach((m, i) => {
    addTo(posKey(m.coords[0]), { i, end: "start" });
    addTo(posKey(m.coords[m.coords.length - 1]), { i, end: "end" });
  });

  const used = new Set();
  const chains = [];

  const extend = (chain, atEnd) => {
    // Each pass consumes at most one member, so members.length is a hard bound.
    for (let guard = 0; guard <= members.length; guard++) {
      const tip = atEnd ? chain[chain.length - 1] : chain[0];
      const candidates = byKey.get(posKey(tip)) ?? [];
      const pick = candidates.find((c) => !used.has(c.i));
      if (!pick) break;
      used.add(pick.i);

      const pts = members[pick.i].coords;
      // "start" means the way's first vertex sits at the tip.
      if (atEnd) {
        const oriented = pick.end === "start" ? pts : [...pts].reverse();
        for (let j = 1; j < oriented.length; j++) chain.push(oriented[j]);
      } else {
        const oriented = pick.end === "end" ? pts : [...pts].reverse();
        for (let j = oriented.length - 2; j >= 0; j--) chain.unshift(oriented[j]);
      }
    }
  };

  for (let i = 0; i < members.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const chain = [...members[i].coords];
    extend(chain, true);
    extend(chain, false);
    chains.push(chain);
  }

  // Drop vertices duplicated by the join, then require at least two points.
  return chains
    .map((coords) => {
      const out = [];
      for (const p of coords) {
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      return out;
    })
    .filter((coords) => coords.length >= 2);
}

async function main() {
  console.log("Bus route ingest (OSM route relations, stitch member ways)");

  const body = await overpass(
    `[out:json][timeout:180];
rel["type"="route"]["route"~"^(bus|coach)$"](${BBOX});
out meta;
way(r);
out geom;`,
    "bus routes",
  );

  const relations = (body.elements ?? []).filter((e) => e.type === "relation");
  const ways = new Map();
  for (const el of body.elements ?? []) {
    if (el.type === "way" && Array.isArray(el.geometry)) ways.set(el.id, el.geometry);
  }
  console.log(`  OSM route relations: ${relations.length} (${ways.size} member ways fetched)`);

  // Deterministic: ascending relation id, so the file diffs cleanly.
  relations.sort((a, b) => a.id - b.id);

  const features = [];
  let stitched = 0;
  let multi = 0;
  let skipped = 0;
  const refs = new Set();

  for (const rel of relations) {
    const t = rel.tags ?? {};
    refs.add(t.ref ?? t.name ?? `relation/${rel.id}`);

    const members = [];
    for (const m of rel.members ?? []) {
      if (m.type !== "way") continue;
      if (!GEOMETRY_ROLES.has(m.role ?? "")) continue;
      const geom = ways.get(m.ref);
      if (!geom || geom.length < 2) continue;
      members.push({ coords: geom.map((p) => [p.lon, p.lat]) });
    }

    const chains = stitchWays(members);
    if (chains.length === 0) {
      skipped++;
      console.log(`  relation/${rel.id}: no stitchable way geometry, skipped`);
      continue;
    }

    const geometry =
      chains.length === 1
        ? { type: "LineString", coordinates: chains[0] }
        : { type: "MultiLineString", coordinates: chains };
    if (chains.length === 1) stitched++;
    else multi++;

    const id = `relation/${rel.id}`;
    features.push({
      type: "Feature",
      id,
      geometry: roundCoords(geometry, 6),
      properties: {
        id,
        osm: id,
        ref: t.ref ?? null,
        name: t.name ?? null,
        from: t.from ?? null,
        to: t.to ?? null,
        operator: t.operator ?? null,
        type: t.type ?? null,
        route: t.route ?? null,
        network: t.network ?? null,
        wikidata: t.wikidata ?? null,
        osmVersion: rel.version ?? null,
        osmTimestamp: rel.timestamp ?? null,
        source: "osm",
      },
    });
  }

  console.log(`  stitched LineString:   ${stitched}`);
  console.log(`  MultiLineString fallback: ${multi}`);
  console.log(`  skipped (no members):  ${skipped}`);
  console.log(`  distinct refs:         ${refs.size}`);

  const src = SOURCES.osmIOM;
  const fc = {
    type: "FeatureCollection",
    name: "bus-routes",
    properties: {
      generated: new Date().toISOString(),
      source: src.name,
      sourceId: "osmIOM",
      sourceUrl: src.url,
      licence: "Open Database License (ODbL)",
      licenceId: "ODbL",
      licenceUrl: "https://opendatacommons.org/licenses/odbl/",
      caveats: [
        "Alignments come only from OSM route relations and are unverified: a route may be missing, drawn along the wrong roads, or split. VERIFY against iombusandrail.im before relying on them. This is geometry, NOT a timetable.",
        "Membership is partial. One feature is emitted per OSM route relation, so a service whose outbound and return are mapped separately appears as two features and its ref repeats.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };
  const bytes = writeJSON(OUT, fc);
  console.log(`\nwrote ${OUT}: ${features.length} routes, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
