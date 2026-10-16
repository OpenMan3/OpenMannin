/**
 * Parish boundary ingestion from OpenStreetMap via the OSM API.
 *
 * Uses api.openstreetmap.org to fetch each admin_level=8 relation
 * individually. This is far more reliable than Overpass, which is
 * chronically overloaded.
 *
 *   node --experimental-strip-types scripts/ingest-parishes.mjs
 */

import { writeJSON, sleep, roundCoords } from "./lib/fetch.mjs";

const OSM_API = "https://api.openstreetmap.org/api/0.6";
const UA = "OpenMannin-project-ingest/1.0 (https://openmannin.im)";

/** All 24 admin_level=8 relations on the Isle of Man (17 parishes + towns). */
const RELATION_IDS = [
  1028021, 1028023, 1028024, 1028066, 1029647, 1029648, 1029649, 1029669,
  1029670, 1031319, 1032811, 1034178, 1061131, 1061132, 1061133, 1061134,
  1061136, 1061137, 1061138, 1061139, 1061140, 1061141, 1061142, 1061143,
];

/**
 * Reconstruct closed rings from a set of OSM ways.
 * Each way has a geometry array of {lat, lon} points.
 */
function reconstructRings(ways) {
  // Round coordinates to 6 decimal places for matching (approx 0.1m precision)
  const key = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

  const nodeWays = new Map();
  for (const way of ways) {
    const geom = way.geometry;
    if (!geom || geom.length < 2) continue;
    const startKey = key(geom[0]);
    const endKey = key(geom[geom.length - 1]);
    if (!nodeWays.has(startKey)) nodeWays.set(startKey, []);
    if (!nodeWays.has(endKey)) nodeWays.set(endKey, []);
    nodeWays.get(startKey).push({ way, reversed: false });
    nodeWays.get(endKey).push({ way, reversed: true });
  }

  const visited = new Set();
  const rings = [];

  for (const way of ways) {
    if (visited.has(way.id)) continue;
    const ring = [];
    let current = way;
    let currentReversed = false;

    // Remember the ring's starting point to detect closure
    const ringStartKey = key(way.geometry[0]);

    for (let i = 0; i < ways.length + 1; i++) {
      visited.add(current.id);
      ring.push({ way: current, reversed: currentReversed });

      const geom = current.geometry;
      const endPoint = currentReversed ? geom[0] : geom[geom.length - 1];
      const endKey = key(endPoint);

      // Check if we've returned to the ring's starting point (closed ring)
      if (endKey === ringStartKey && ring.length > 1) {
        // Ring is closed!
        break;
      }

      const candidates = nodeWays.get(endKey) ?? [];
      // Find an unvisited way that connects to this endpoint
      let next = null;
      let nextReversed = false;
      for (const c of candidates) {
        if (!visited.has(c.way.id)) {
          next = c.way;
          nextReversed = c.reversed;
          break;
        }
      }
      if (!next) break;

      current = next;
      currentReversed = nextReversed;
    }

    // Only emit genuinely closed rings; open chains are dangling ways that
    // would be artificially closed into spokes, producing a mesh.
    const lastRing = ring[ring.length - 1];
    const lastGeom = lastRing.way.geometry;
    const lastEnd = lastRing.reversed ? lastGeom[0] : lastGeom[lastGeom.length - 1];
    const firstGeom = ring[0].way.geometry;
    const firstStart = ring[0].reversed ? firstGeom[firstGeom.length - 1] : firstGeom[0];
    const closed = key(lastEnd) === key(firstStart);
    if (ring.length >= 2 && closed) rings.push(ring);
  }

  return rings;
}

/** Parse OSM XML relation response into a structured object. */
function parseRelationXml(xml) {
  const _rb = xml.match(/<relation\s+id="\d+"[^>]*>([\s\S]*?)<\/relation>/)?.[1] ?? xml;
  const _tg = {};
  for (const _m of _rb.matchAll(/<tag k="([^"]+)" v="([^"]+)"\/>/g)) _tg[_m[1]] = _m[2];

  // Extract tags ONLY from the relation element itself, not member ways/nodes.
  const relationBlock = xml.match(/<relation\s+id="\d+"[^>]*>([\s\S]*?)<\/relation>/)?.[1] ?? xml;
  const tags = {};
  const tagMatches = relationBlock.matchAll(/<tag k="([^"]+)" v="([^"]+)"\/>/g);
  for (const m of tagMatches) tags[m[1]] = m[2];

  // Member roles tell outer vs inner boundaries for multipolygon relations.
  const memberRole = new Map();
  for (const m of xml.matchAll(/<member\s+([^>]*?)\/?>/g)) {
    const attrs = m[1];
    if (!/type="way"/.test(attrs)) continue;
    const refM = attrs.match(/ref="(\d+)"/);
    if (!refM) continue;
    const roleM = attrs.match(/role="([^"]*)"/);
    memberRole.set(Number(refM[1]), roleM ? roleM[1] : "");
  }

  // Extract all nodes with coordinates - nodes have many attributes, use flexible regex
  // lat/lon can be negative, so include - in character class
  const nodes = new Map();
  const nodeMatches = xml.matchAll(/<node\s+id="(\d+)"[^>]*\slat="([-\d.]+)"\s+lon="([-\d.]+)"/g);
  for (const m of nodeMatches) nodes.set(Number(m[1]), { lat: Number(m[2]), lon: Number(m[3]) });

  if (memberRole.size === 0) {}
  // Extract way members with their node references
  const ways = [];
  const wayMatches = xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g);
  for (const m of wayMatches) {
    const wayId = Number(m[1]);
    const wayBody = m[2];
    const ndRefs = [...wayBody.matchAll(/<nd ref="(\d+)"\/>/g)].map((nm) => Number(nm[1]));
    const geometry = ndRefs.map((ref) => nodes.get(ref)).filter(Boolean);
    if (geometry.length >= 2) ways.push({ id: wayId, geometry, role: memberRole.get(wayId) ?? "" });
  }

  return { tags, ways };
}

async function fetchRelation(id) {
  const res = await fetch(`${OSM_API}/relation/${id}/full`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRelationXml(xml);
}

async function main() {
  console.log("Parish boundary ingest (OSM API)");

  const features = [];
  for (const id of RELATION_IDS) {
    try {
      const { tags, ways } = await fetchRelation(id);
      const name = tags.name ?? tags["name:en"] ?? null;
      if (!name) {
        console.log(`  ${id}: no name, skipping`);
        continue;
      }

      if (ways.length < 2) {
        console.log(`  ${name}: only ${ways.length} way(s), skipping`);
        continue;
      }

      // OSM multipolygon relations carry outer/inner roles on ways.
      // Treat unlabelled (role "") as outer.
      const outerWays = ways.filter((w) => w.role === "outer" || w.role === "");
      const innerWays = ways.filter((w) => w.role === "inner");
      const waySource = outerWays.length > 0 ? outerWays : ways;

      const outerRingsRaw = reconstructRings(waySource);
      const innerRingsRaw = innerWays.length > 0 ? reconstructRings(innerWays) : [];

      // Each reconstructed ring is a list of ways; flatten them into one
      // closed coordinate ring (deduping shared endpoints between segments).
      const flattenRing = (ring) => {
        const coords = [];
        for (const { way, reversed } of ring) {
          const geom = reversed ? [...way.geometry].reverse() : way.geometry;
          const pts = geom.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);
          for (const pt of pts) {
            // Drop duplicates of the last pushed point to avoid repeated vertices.
            const last = coords[coords.length - 1];
            if (!last || last[0] !== pt[0] || last[1] !== pt[1]) coords.push(pt);
          }
        }
        // Close the ring if necessary.
        if (coords.length > 0) {
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
        }
        return coords;
      };

      const outerFlat = outerRingsRaw.map(flattenRing).filter((r) => r.length >= 4);
      const innerFlat = innerRingsRaw.map(flattenRing).filter((r) => r.length >= 4);

      const pointInRing = (pt, ring) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if ((yi > pt[1]) !== (yj > pt[1]) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };

      // Sort outer rings by number of points descending so larger rings come first.
      outerFlat.sort((a, b) => b.length - a.length);

      // Group inner rings (holes) under whichever outer ring contains them.
      const exteriors = outerFlat.map((ext) => {
        const holes = innerFlat.filter((inner) => pointInRing(inner[0], ext));
        return { exterior: ext, holes };
      });

      // If there were no role labels (inner empty) but multiple outer rings that
      // nest by containment, reclassify using size + containment fallback.
      if (innerWays.length === 0 && outerFlat.length > 1) {
        const consumed = new Set();
        const rebuilt = [];
        for (let i = 0; i < outerFlat.length; i++) {
          if (consumed.has(i)) continue;
          const holes = [];
          for (let j = i + 1; j < outerFlat.length; j++) {
            if (consumed.has(j)) continue;
            if (pointInRing(outerFlat[j][0], outerFlat[i])) {
              holes.push(outerFlat[j]);
              consumed.add(j);
            }
          }
          rebuilt.push({ exterior: outerFlat[i], holes });
          consumed.add(i);
        }
        exteriors.length = 0;
        exteriors.push(...rebuilt);
      }

      // Containment checks can nest; if a ring is inside a hole of another exterior,
      // promote it as its own exterior. Handle via second pass: already done above
      // since outer-first due to sort by size.

      const geometry =
        exteriors.length === 1
          ? exteriors[0].holes.length === 0
            ? { type: "Polygon", coordinates: [exteriors[0].exterior] }
            : { type: "Polygon", coordinates: [exteriors[0].exterior, ...exteriors[0].holes] }
          : {
              type: "MultiPolygon",
              coordinates: exteriors.map((e) =>
                e.holes.length === 0
                  ? [e.exterior]
                  : [e.exterior, ...e.holes],
              ),
            };

      features.push({
        type: "Feature",
        id: `relation/${id}`,
        geometry,
        properties: {
          name,
          nameEn: tags["name:en"] ?? null,
          adminLevel: 8,
          source: "osm",
        },
      });
      console.log(`  ${name}: ${ways.length} ways, ${outerRingsRaw.length} rings, ${innerRingsRaw.length} holes-raw`);
    } catch (err) {
      console.log(`  ${id}: FAILED (${err.message.slice(0, 60)})`);
    }

    await sleep(1000);
  }

  console.log(`\n  parish polygons: ${features.length}`);

  const fc = {
    type: "FeatureCollection",
    name: "parish-boundaries",
    properties: {
      generated: new Date().toISOString(),
      source: "OpenStreetMap contributors",
      licence: "ODbL",
      caveats: [
        "Parish boundaries are from OSM (admin_level=8). They are community-mapped and may not match exact legal boundaries.",
        "Attribution required: (c) OpenStreetMap contributors, ODbL.",
      ],
    },
    features,
  };

  const bytes = writeJSON("public/data/parish-boundaries.geojson", fc);
  console.log(`\nwrote parish-boundaries.geojson: ${features.length} parishes, ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
