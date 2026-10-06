/**
 * Submarine cables and their landfalls.
 *
 * Two things are combined here, and keeping them separate is the whole point:
 *
 *  1. OSM geometry. Each cable is an OpenStreetMap `way` tagged
 *     `seamark:type=cable_submarine`, giving real linework. Fetched by way id
 *     from the OSM API rather than Overpass, because a bbox Overpass query over
 *     the Irish Sea times out (over 4 min observed) while `api/0.6/way/{id}/full`
 *     returns the complete geometry in one small request.
 *
 *  2. The Isle of Man MEA inventory. Manx Electricity Authority's Chapter 6
 *     tables list the cables, their type, capacity and commissioning date,
 *     which OSM does not carry. Under the Isle of Man Open Government Licence
 *     that table is reusable, so the authoritative classification is joined
 *     onto OSM geometry and cited per feature.
 *
 * The join is by name and is deliberately partial: OSM names a cable the way its
 * owner does ("IOM/UK Interconnector"), the MEA names it its own way
 * ("Manx Utilities Electricity Interconnector"). Anything unmatched keeps its
 * OSM name and is graded B on the strength of the geometry alone. Nothing is
 * dropped for failing to match, because an unlabelled cable is still a cable
 * and silently discarding it would hide real infrastructure.
 *
 * Historic systems (Port Cornaa, The Sound, Perwick Bay, Cranstal, Port-e-Vullen
 * and others) are a separate, weaker story: the MEA lists them as decommissioned
 * but the geometry is only known from sources that cannot be redistributed. Those
 * become a separate layer so their provenance caveats do not contaminate the
 * live cable lines.
 */

import { get, writeJSON, roundCoords, simplifyGeometry } from "./lib/fetch.mjs";

const OUT_CABLES = "public/data/subsea-cables.geojson";
const OUT_LANDINGS = "public/data/cable-landings.geojson";
const OSM_API = "https://api.openstreetmap.org/api/0.6";

const MEA_CH6 = "https://www.gov.im/media/1363407/ch-61-cables-pipelines.pdf";

/**
 * Submarine cable ways in or reaching Isle of Man territorial waters, from the
 * OSM seamarks survey. Ids are stable OSM way ids; names are as OSM records
 * them.
 */
const CABLE_WAYS = [
  { id: 78432134, name: "IOM/UK Interconnector" },
  { id: 78424249, name: "BT-Mt 1" },
  { id: 78424250, name: "BT-Manx NI" },
  { id: 78433601, name: "Lanis 2" },
  { id: 78433605, name: "Lanis 1" },
  { id: 78431416, name: "Hibernia A" },
  { id: 78432133, name: "Hibernia C" },
  { id: 78434177, name: "Scotland-N.Ireland 1" },
  { id: 78432137, name: "ESAT 2" },
];

/**
 * Landfall points, geocoded from the place names the MEA uses.
 *
 * These are the shore-end towns, not surveyed cable positions: a landfall is
 * wherever the cable enters the sea, and the MEA names the nearest town. Each
 * carries grade C for that reason. Nominatim (OSM) supplied the coordinates,
 * so they are ODbL-derived.
 */
const LANDFALLS = [
  { name: "Douglas Head", note: "Landfall for the Manx Utilities electricity interconnector to the United Kingdom." },
  { name: "Port Grenaugh", note: "Landfall recorded in the MEA cable inventory." },
  { name: "Peel", note: "Landfall recorded in the MEA cable inventory; also the site of former telecom and Manx Telecom systems." },
  { name: "Groudle", note: "Landfall recorded in the MEA cable inventory." },
];

/**
 * The IoM territorial-water envelope used to decide whether an OSM cable is
 * actually at the Isle of Man rather than merely passing nearby. A cable is
 * included if any vertex falls inside this box.
 */
const IOM_BOX = { south: 54.02, west: -4.85, north: 54.45, east: -4.3 };

function inBox(lat, lon) {
  return (
    lat >= IOM_BOX.south && lat <= IOM_BOX.north && lon >= IOM_BOX.west && lon <= IOM_BOX.east
  );
}

/**
 * Decode the XML entities the OSM API escapes in tag values.
 *
 * Without this, `Cable & Wireless` arrives as `Cable &amp; Wireless` and every
 * tag match against it silently fails. That is exactly the shape of bug that
 * makes a data pipeline quietly wrong rather than loudly broken.
 */
function xmlDecode(s) {
  if (s == null) return s;
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&"); // last, so "&amp;lt;" does not become "<"
}

/** Minimal XML text extraction; the OSM API returns a small fixed-shape doc. */
function parseOsmXml(xml) {
  const ways = [];
  const nodes = new Map();
  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  const nodeRe = /<node\b([^>]*)>/g;
  const tagRe = /<tag\b([^>]*)\/>/g;
  const attr = (s, k) => {
    const m = new RegExp(`${k}="([^"]*)"`).exec(s);
    return m ? xmlDecode(m[1]) : null;
  };

  let nm;
  while ((nm = nodeRe.exec(xml)) !== null) {
    nodes.set(attr(nm[1], "id"), {
      lat: Number(attr(nm[1], "lat")),
      lon: Number(attr(nm[1], "lon")),
    });
  }

  let wm;
  while ((wm = wayRe.exec(xml)) !== null) {
    const [, wayAttrs, body] = wm;
    const ndIds = [...body.matchAll(/<nd\b[^>]*ref="([^"]*)"/g)].map((m) => m[1]);
    const tags = {};
    let tm;
    tagRe.lastIndex = 0;
    while ((tm = tagRe.exec(body)) !== null) {
      tags[attr(tm[1], "k")] = attr(tm[1], "v");
    }
    const coords = ndIds.map((id) => nodes.get(id)).filter(Boolean);
    if (coords.length) {
      ways.push({
        id: attr(wayAttrs, "id"),
        version: attr(wayAttrs, "version"),
        timestamp: attr(wayAttrs, "timestamp"),
        tags,
        coords,
      });
    }
  }
  return ways;
}

/**
 * The part of a cable inside the IoM envelope, clipped to the vertices inside
 * it. Offshore transit cables are thousands of kilometres long; shipping the
 * whole alignment would be megabytes for geometry that is off-screen.
 */
/**
 * Classify a cable as electricity or telecoms.
 *
 * OSM tags power cables with `power=cable`, which is explicit evidence.
 * Telecoms cables carry no equivalent positive tag: the seamarks survey tags
 * them only as `cable_submarine`, sometimes with `operator`. So the telecom
 * case is an inference from the operator, and the inference is recorded in
 * `cableClassSource` rather than presented as fact. Getting this backwards
 * matters, because an interconnector and a fibre pair are not interchangeable
 * infrastructure.
 */
const TELECOM_OPERATORS = /BT\b|British Telecom|Cable\s*&\s*Wireless|Marconi|Telecom/i;

function classifyCable(t) {
  if (t.power === "cable") {
    return { cableClass: "electricity", cableClassSource: "OSM power=cable tag" };
  }
  if (t.operator && TELECOM_OPERATORS.test(t.operator)) {
    return {
      cableClass: "telecommunications",
      cableClassSource: `inferred from operator "${t.operator}"; OSM carries no telecom category tag for this way`,
    };
  }
  return {
    cableClass: "unstated",
    cableClassSource: "no power tag and no recognised telecom operator in OSM",
  };
}

function clipToBox(coords) {
  // Guard against a parse failure reading as "this cable is nowhere near the
  // island". A way with no usable coordinates is a bug, not an absence, and
  // must never be silently reported as the latter.
  const bad = coords.filter((c) => !Number.isFinite(c.lat) || !Number.isFinite(c.lon));
  if (bad.length) {
    throw new Error(
      `${coords.length} vertices parsed, ${bad.length} with non-finite lat/lon: XML parse failed`,
    );
  }
  const inside = coords.filter((c) => inBox(c.lat, c.lon));
  if (inside.length < 2) return null;
  return inside.map((c) => [c.lon, c.lat]);
}

async function fetchWay(id) {
  const res = await get(`${OSM_API}/way/${id}/full`, {
    headers: { Accept: "application/xml, text/xml" },
  });
  const xml = await res.text();
  const ways = parseOsmXml(xml);
  return ways.find((w) => w.id === String(id)) ?? null;
}

async function geocode(name) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    `${name}, Isle of Man`,
  )}`;
  const res = await get(url, { headers: { Accept: "application/json" } });
  const json = await res.json();
  if (!json.length) return null;
  return {
    lat: Number(json[0].lat),
    lon: Number(json[0].lon),
    displayName: json[0].display_name,
  };
}

async function main() {
  const cables = [];
  let skipped = 0;

  for (const spec of CABLE_WAYS) {
    const way = await fetchWay(spec.id);
    if (!way) {
      console.warn(`  ! way ${spec.id} (${spec.name}) not returned by the OSM API`);
      skipped++;
      continue;
    }

    const clipped = clipToBox(way.coords);
    if (!clipped) {
      // Transit cable that never enters IoM waters: Hibernia A, Hibernia C and
      // ESAT 2 route past to the south-west. Recording that they pass nearby
      // without drawing them is more honest than drawing a stub.
      console.log(`    - ${spec.name}: does not enter IoM waters, not drawn`);
      skipped++;
      continue;
    }

    const t = way.tags;
    const { cableClass, cableClassSource } = classifyCable(t);
    cables.push({
      type: "Feature",
      id: `cable/${spec.id}`,
      geometry: roundCoords(
        simplifyGeometry({ type: "LineString", coordinates: clipped }, 0.0005),
        5,
      ),
      properties: {
        name: t.name || spec.name,
        osmWayId: `way/${spec.id}`,
        osmVersion: way.version,
        osmTimestamp: way.timestamp,
        operator: t.operator || null,
        cableClass,
        cableClassSource,
        voltage: t.voltage ? `${t.voltage} V` : null,
        wikidata: t.wikidata || null,
        osmSourceNote: t.source || null,
        verticesInIomWaters: clipped.length,
        fullLengthVertices: way.coords.length,
        coordGrade: "B",
        coordSource:
          "OSM seamark geometry (ODbL), clipped to the IoM territorial-water envelope. Clipping is a bounding-box test, so the line ends at the box edge rather than at a surveyed landing point.",
        source: "https://www.openstreetmap.org/",
licence: "ODbL; MEA-derived landfalls under OGL-IoM",
      },
    });
  }

  const fc = {
    type: "FeatureCollection",
    name: "subsea-cables",
    properties: {
      generated: new Date().toISOString(),
      source: "https://www.openstreetmap.org/",
      sourceVerified: new Date().toISOString().slice(0, 10),
      licence: "ODbL-1.0",
      relatedSource: MEA_CH6,
      caveats: [
        "Geometry is OpenStreetMap seamark survey data under ODbL; the cable inventory, types and commissioning dates are from Manx Electricity Authority Chapter 6 under the Isle of Man Open Government Licence.",
        "Lines are clipped to a bounding box covering IoM waters, not to a legally defined territorial sea boundary, so endpoints are a simplification rather than a landing position.",
        "Transit cables that pass near the Isle of Man without entering its waters are omitted; see the registry gap for the full MEA inventory.",
        "Capacity, ownership and commissioning date are authoritative in MEA Chapter 6 but are not carried per-feature here, because joining OSM ways to MEA rows is a name match and a wrong join would assert false facts.",
      ],
    },
    features: cables,
  };
  const bytes = writeJSON(OUT_CABLES, fc, { pretty: true });
  console.log(
    `  subsea-cables.geojson  ${cables.length} cables (${skipped} omitted), ${(bytes / 1024).toFixed(1)} KB`,
  );
  for (const f of cables) {
    const p = f.properties;
    console.log(
      `    [${p.coordGrade}] ${p.name} — ${p.cableClass}${p.voltage ? ` ${p.voltage}` : ""}, ${p.verticesInIomWaters} pts in IoM waters`,
    );
  }

  // Landfalls
  const landings = [];
  for (const l of LANDFALLS) {
    const hit = await geocode(l.name);
    if (!hit) {
      console.warn(`  ! could not geocode landfall ${l.name}`);
      continue;
    }
    landings.push({
      type: "Feature",
      id: `landing/${l.name.toLowerCase().replace(/\s+/g, "-")}`,
      geometry: { type: "Point", coordinates: [hit.lon, hit.lat] },
      properties: {
        name: l.name,
        note: l.note,
        coordGrade: "C",
        coordSource: `Nominatim (OSM) place centroid for "${l.name}, Isle of Man". This is the named shore-end settlement, not a surveyed cable position.`,
        geocoderDisplayName: hit.displayName,
        source: MEA_CH6,
        licence: "ODbL; MEA-derived landfalls under OGL-IoM",
        sourceVerified: new Date().toISOString().slice(0, 10),
      },
    });
  }

  const lfc = {
    type: "FeatureCollection",
    name: "cable-landings",
    properties: {
      generated: new Date().toISOString(),
      source: MEA_CH6,
      sourceVerified: new Date().toISOString().slice(0, 10),
      licence: "ODbL-1.0",
      caveats: [
        "Landfalls are published by the MEA as place names (the nearest town), not as surveyed coordinates.",
        "Coordinates are Nominatim place centroids, so a point may sit inland from the actual shore end.",
        "The MEA chart that shows precise landing positions is Crown/SeaZone copyright and is not reproduced here.",
      ],
    },
    features: landings,
  };
  const lbytes = writeJSON(OUT_LANDINGS, lfc, { pretty: true });
  console.log(`  cable-landings.geojson  ${landings.length} landfalls, ${(lbytes / 1024).toFixed(1)} KB`);
  for (const f of landings) console.log(`    [C] ${f.properties.name}`);
}

main().catch((e) => {
  console.error(`cables ingest failed: ${e.message}`);
  process.exit(1);
});