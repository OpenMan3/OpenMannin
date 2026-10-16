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

    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}

/** Parse OSM XML relation response into a structured object. */
function parseRelationXml(xml) {
  // Extract relation tags - use fresh regex each time to avoid lastIndex issues
  const tags = {};
  const tagMatches = xml.matchAll(/<tag k="([^"]+)" v="([^"]+)"\/>/g);
  for (const m of tagMatches) tags[m[1]] = m[2];

  // Extract all nodes with coordinates - nodes have many attributes, use flexible regex
  // lat/lon can be negative, so include - in character class
  const nodes = new Map();
  const nodeMatches = xml.matchAll(/<node\s+id="(\d+)"[^>]*\slat="([-\d.]+)"\s+lon="([-\d.]+)"/g);
  for (const m of nodeMatches) nodes.set(Number(m[1]), { lat: Number(m[2]), lon: Number(m[3]) });

  // Extract way members with their node references
  const ways = [];
  const wayMatches = xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g);
  for (const m of wayMatches) {
    const wayId = Number(m[1]);
    const wayBody = m[2];
    const ndRefs = [...wayBody.matchAll(/<nd ref="(\d+)"\/>/g)].map((nm) => Number(nm[1]));
    const geometry = ndRefs.map((ref) => nodes.get(ref)).filter(Boolean);
    if (geometry.length >= 2) ways.push({ id: wayId, geometry });
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

      if (ways.length < 3) {
        console.log(`  ${name}: only ${ways.length} ways, skipping`);
        continue;
      }

      const rings = reconstructRings(ways);
      if (rings.length === 0) {
        console.log(`  ${name}: no rings reconstructed`);
        continue;
      }

      const polygons = rings.map((ring) => {
        const coords = ring.map(({ way, reversed }) => {
          const geom = reversed
            ? [...way.geometry].reverse()
            : way.geometry;
          return geom.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);
        });
        for (const line of coords) {
          const first = line[0];
          const last = line[line.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            line.push([...first]);
          }
        }
        return coords;
      });

      polygons.sort((a, b) => b.length - a.length);
      const exterior = polygons[0];

      // Only include rings that are genuinely inside the exterior as holes.
      // Smaller rings from the OSM relation reconstruction that fall outside
      // the exterior are fragments, not holes - including them as holes creates
      // triangular/hexagonal cutouts in the parish fill.
      const pointInRing = (pt, ring) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if ((yi > pt[1]) !== (yj > pt[1]) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
      };

      const holes = polygons.slice(1).filter((ring) => pointInRing(ring[0], exterior));

      const geometry =
        holes.length === 0
          ? { type: "Polygon", coordinates: [exterior] }
          : { type: "Polygon", coordinates: [exterior, ...holes] };

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
      console.log(`  ${name}: ${ways.length} ways, ${rings.length} rings`);
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