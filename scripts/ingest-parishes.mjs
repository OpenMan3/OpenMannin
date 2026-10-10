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
  const nodeWays = new Map();
  for (const way of ways) {
    const geom = way.geometry;
    if (!geom || geom.length < 2) continue;
    const startKey = `${geom[0].lat},${geom[0].lon}`;
    const endKey = `${geom[geom.length - 1].lat},${geom[geom.length - 1].lon}`;
    if (!nodeWays.has(startKey)) nodeWays.set(startKey, []);
    if (!nodeWays.has(endKey)) nodeWays.set(endKey, []);
    nodeWays.get(startKey).push({ way, isStart: true });
    nodeWays.get(endKey).push({ way, isStart: false });
  }

  const visited = new Set();
  const rings = [];

  for (const way of ways) {
    if (visited.has(way.id)) continue;
    const ring = [];
    let current = way;

    for (let i = 0; i < ways.length + 1; i++) {
      visited.add(current.id);
      ring.push(current);

      const geom = current.geometry;
      const endPoint = geom[geom.length - 1];
      const endKey = `${endPoint.lat},${endPoint.lon}`;

      const candidates = nodeWays.get(endKey) ?? [];
      const next = candidates.find((c) => !visited.has(c.way.id));
      if (!next) break;

      current = next.way;

      const startPoint = current.geometry[0];
      if (startPoint.lat === endPoint.lat && startPoint.lon === endPoint.lon) {
        visited.add(current.id);
        ring.push(current);
        break;
      }
    }

    if (ring.length >= 3) rings.push(ring);
  }

  return rings;
}

/** Parse OSM XML relation response into a structured object. */
function parseRelationXml(xml) {
  // Extract relation tags
  const tags = {};
  const tagRegex = /<tag k="([^"]+)" v="([^"]+)"\/>/g;
  let match;
  while ((match = tagRegex.exec(xml)) !== null) {
    tags[match[1]] = match[2];
  }

  // Extract all nodes with coordinates
  const nodes = new Map();
  const nodeRegex = /<node id="(\d+)" lat="([\d.]+)" lon="([\d.]+)"/g;
  while ((match = nodeRegex.exec(xml)) !== null) {
    nodes.set(Number(match[1]), { lat: Number(match[2]), lon: Number(match[3]) });
  }

  // Extract way members with their node references
  const ways = [];
  const wayRegex = /<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g;
  while ((match = wayRegex.exec(xml)) !== null) {
    const wayId = Number(match[1]);
    const wayBody = match[2];
    const ndRefs = [];
    const ndRegex = /<nd ref="(\d+)"\/>/g;
    let ndMatch;
    while ((ndMatch = ndRegex.exec(wayBody)) !== null) {
      ndRefs.push(Number(ndMatch[1]));
    }
    // Build geometry from node coordinates
    const geometry = [];
    for (const ref of ndRefs) {
      const node = nodes.get(ref);
      if (node) geometry.push(node);
    }
    if (geometry.length >= 2) {
      ways.push({ id: wayId, geometry });
    }
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
        const coords = ring.map((way) =>
          way.geometry.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
        );
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
      const holes = polygons.slice(1);

      const geometry =
        holes.length === 0
          ? { type: "Polygon", coordinates: exterior }
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