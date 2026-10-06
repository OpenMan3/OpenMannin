/**
 * Harbours, marinas, piers and linkspans.
 *
 * Every port on the Isle of Man is tidal, which is the single fact that most
 * shapes this layer. The tide range in the north-east approaches runs to about
 * 8 m; vessels over about 7 m are effectively sized out of the island. The
 * harbour areas below are the OSM-mapped water bodies, and the piers are the
 * permanent landing structures that let anything work at all without a
 * constant warping of cable and chain.
 *
 * PROVENANCE HONESTY. The geometry is OpenStreetMap, and the piers carry an
 * `Isle of Man Government 1:25000 map (2007)` source tag, so the shapes are
 * traceable and pre-date this project. Where OSM says `note=approximate outline
 * only` that note is preserved in the output rather than smoothed away. Douglas
 * Harbour and Peel Harbour are two separate, overlapping mapped areas in OSM;
 * both are kept because collapsing them would hide that disagreement.
 *
 * Statutory status is asserted separately from geometry. The nine statutory
 * ports under the Harbours Act are named explicitly, and anything not on that
 * list is presented as a harbour or mooring rather than being upgraded to
 * statutory status by implication.
 */

import { get, writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/ports.geojson";

/** Overpass endpoints tried in order; public mirrors rotate under load. */
const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** The island bounding box used for all queries. */
const BBOX = "54.02,-4.85,54.45,-4.30";

/**
 * The nine statutory ports under the Isle of Man Harbours Act 2010. Stated as a
 * list so the UI can distinguish statutory ports from the rest.
 *
 * Two of the nine - Port Cornaa and Groudle - have NO mapped harbour area in
 * OpenStreetMap. Rather than let them silently vanish from a layer whose whole
 * purpose is to show the island's ports, they are added below as explicit,
 * heavily-flagged grade-C points. Groudle in particular is a small landing and
 * Port Cornaa is primarily a cable landing; neither has a harbour polygon in
 * any source consulted, and pretending otherwise would be an invented boundary.
 */
const STATUTORY = [
  "Douglas",
  "Ramsey",
  "Peel",
  "Castletown",
  "Port Erin",
  "Port St Mary",
  "Laxey",
  "Port Cornaa",
  "Groudle",
];

/**
 * Statutory ports with no OSM harbour geometry, geocoded to the settlement or
 * feature name. `isCableLanding` marks Port Cornaa, which is a live subsea
 * cable landing rather than a general harbour.
 */
const UNMAPPED_STATUTORY = [
  {
    name: "Port Cornaa",
    lat: 54.2624291,
    lon: -4.3445010,
    displayName: "Port Cornaa, Isle of Man",
    isCableLanding: true,
    note: "No harbour area is mapped in OSM. Port Cornaa is a landing, and is the shore end of live subsea cables rather than a general-purpose harbour.",
  },
  {
    name: "Groudle",
    lat: 54.1779333,
    lon: -4.4308261,
    displayName: "Groudle, A11, Onchan, Middle, IM3 2JY, Isle of Man",
    isCableLanding: false,
    note: "No harbour area is mapped in OSM. Groudle is a small landing serving Groudle Glen and the nature reserve, not a harbour with a mapped basin.",
  },
];

/**
 * Subsidiary features that sit INSIDE a statutory port's harbour rather than
 * being a statutory port in their own right. Douglas Inner Harbour Marina and
 * Peel Marina are marinas within Douglas and Peel; counting them as separate
 * statutory ports would double-count the island's ports and overstate it.
 */
const SUBSIDIARY_OF = {
  "Douglas Inner Harbour Marina": "Douglas",
  "Peel Marina": "Peel",
  "Peel Inner Harbour": "Peel",
};

const QUERY = `[out:json][timeout:90];
(
  node["seamark:type"~"harbour|breakwater|jetty"](${BBOX});
  way["seamark:type"~"harbour|breakwater|jetty"](${BBOX});
  way["landuse"="harbour"](${BBOX});
  way["leisure"="marina"](${BBOX});
  node["man_made"="pier"](${BBOX});
  way["man_made"="pier"](${BBOX});
  node["man_made"~"jetty|linkspan|groin"](${BBOX});
  way["man_made"~"jetty|linkspan|groin"](${BBOX});
);
out tags geom;`;

const CAVEATS = [
  "All eight listed ports and every pier are TIDAL. The north-east approaches see about 8 m of range, so vessels above roughly 7 m are constrained. Harbour geometry is OSM-derived and carries no published depth survey.",
  "These are mapped harbour AREAS and landing structures, not berth allocations. There is no authoritative, machine-readable berth or pontoon dataset for the Isle of Man, so nothing here indicates who may occupy a given pontoon.",
  "Several piers are tagged `Isle of Man Government 1:25000 map (2007)` as their source. The outlines are therefore at best 2007 vintage and should not be treated as surveyed to modern accuracy.",
  "Douglas Harbour and Peel Harbour exist in OSM as overlapping mapped areas. Both are retained; see the overlap note in each feature's properties.",
  "Statutory port status is asserted from the Harbours Act list, not derived from the geometry. A harbour named here that is not on that list is still a harbour - it simply is not a statutory port.",
  "Two of the nine statutory ports (Port Cornaa, Groudle) have NO mapped harbour geometry in any source consulted. They appear as grade-C points with geometryPresent=false. Their positions are settlement centroids, not harbour boundaries, and no basin outline should be inferred from them.",
  "Douglas Inner Harbour Marina and Peel Marina are marinas WITHIN Douglas and Peel, not ports in their own right. They are flagged subsidiaryOfStatutoryPort and are not counted in the statutory total.",
  "Marine limits, dredged channels and any licensing conditions are NOT represented. Port operations and activity must be checked against the Isle of Man Harbours Act and current notices to mariners.",
];

async function overpass() {
  for (const ep of OVERPASS) {
    try {
      const res = await get(ep, {
        method: "POST",
        body: new URLSearchParams({ data: QUERY }),
      });
      const json = await res.json();
      // Nodes answer with lat/lon, never `geometry` - the query uses
      // `out tags geom`, which gives coordinates to nodes and geometry to ways.
      // Filtering on `geometry` alone therefore drops every named pier, jetty,
      // groin and harbour point that OSM keeps as a node. The main loop below
      // already has a node branch; it simply never saw any input.
      const els = (json.elements ?? []).filter(
        (e) => e.tags && (e.geometry || (e.lat != null && e.lon != null)),
      );
      if (els.length) return { els, endpoint: ep };
      console.warn(`  ! ${ep} returned no geometry`);
    } catch (e) {
      console.warn(`  ! ${ep} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("all Overpass endpoints failed");
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function classify(tags) {
  if (tags.landuse === "harbour" || tags.harbour === "yes" || tags["seamark:type"] === "harbour") {
    return { kind: "harbour-area", water: true };
  }
  if (tags.leisure === "marina") return { kind: "marina", water: true };
  if (tags.man_made === "pier") return { kind: "pier", water: false };
  if (tags.man_made === "linkspan") return { kind: "linkspan", water: false };
  if (tags.man_made === "jetty") return { kind: "jetty", water: false };
  if (tags.man_made === "groin") return { kind: "groin", water: false };
  if (tags["seamark:type"] === "breakwater") return { kind: "breakwater", water: false };
  if (tags["seamark:type"] === "jetty") return { kind: "jetty", water: false };
  return { kind: "harbour-feature", water: false };
}

function main() {
  overpass()
    .then(({ els, endpoint }) => {
      console.log(`  fetched ${els.length} elements from ${new URL(endpoint).host}`);

      const features = [];
      const seen = new Set();

      for (const el of els) {
        const t = el.tags;
        const name = t.name || t["name:en"];
        // Keep unnamed breakwaters and groins: they are the real harbour
        // engineering, but drop everything else with no name at all.
        if (!name && !["breakwater", "groin"].includes(classify(t).kind)) continue;

        const { kind, water } = classify(t);
        const label = name || `${kind} (unnamed)`;
        const key = `${slug(label)}-${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let geometry;
        if (el.type === "node") {
          geometry = { type: "Point", coordinates: [el.lon, el.lat] };
        } else {
          const ring = el.geometry.map((p) => [p.lon, p.lat]);
          if (ring.length < 2) continue;
          geometry = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
            ? { type: "Polygon", coordinates: [ring] }
            : { type: "LineString", coordinates: ring };
        }

        // Statutory status is only claimed by an exact harbour-area match, or
        // by an explicit subsidiary declaration. Prefix matching is not safe
        // here: it is what previously promoted "Peel Marina" to a statutory
        // port of its own.
        const isHarbourArea = kind === "harbour-area";
        const subsidiaryOf = SUBSIDIARY_OF[label] ?? null;
        const statutoryPort = subsidiaryOf
          ? false
          : isHarbourArea && STATUTORY.some((s) => label === s || label === `${s} Harbour`);

        features.push({
          type: "Feature",
          id: `port/${key}`,
          geometry: roundCoords(geometry, 6),
          properties: {
            name: label,
            kind,
            statutoryPort,
            subsidiaryOfStatutoryPort: subsidiaryOf,
            locode: t["ref:LOCODE"] ?? null,
            unlocode: t["ref:unlocode"] ?? null,
            tidal: t["access:tide"] === "yes" ? true : water ? true : null,
            mooring: t.mooring === "yes",
            osmSource: t.source ?? null,
            osmApproximate: t.note ?? null,
            overlapNote:
              /^(Douglas|Peel) Harbour$/.test(label) && kind === "harbour-area"
                ? "This overlaps another mapped harbour area of the same name in OSM. Both are retained rather than merged, because merging would assert a boundary nobody has published."
                : null,
            osmId: `${el.type}/${el.id}`,
            coordGrade: t.source?.includes("25000") ? "C" : "B",
            coordSource: t.source
              ? `OpenStreetMap; upstream source tagged in OSM as: ${t.source}`
              : "OpenStreetMap (ODbL)",
            source: "https://www.openstreetmap.org/",
            licence: "ODbL",
            sourceVerified: new Date().toISOString().slice(0, 10),
          },
        });
      }

      // Statutory ports with no mapped geometry, added explicitly.
      for (const p of UNMAPPED_STATUTORY) {
        const key = slug(p.name);
        features.push({
          type: "Feature",
          id: `port/${key}-unmapped`,
          geometry: roundCoords({ type: "Point", coordinates: [p.lon, p.lat] }, 6),
          properties: {
            name: p.name,
            kind: "landing-point",
            statutoryPort: true,
            subsidiaryOfStatutoryPort: null,
            locode: null,
            unlocode: null,
            tidal: true,
            mooring: false,
            geometryPresent: false,
            isCableLanding: p.isCableLanding,
            unmappedNote: p.note,
            osmSource: null,
            osmApproximate: "No harbour geometry exists in OSM for this port.",
            overlapNote: null,
            osmId: null,
            coordGrade: "C",
            coordSource: `Nominatim (OSM) centroid for ${p.displayName}. This is the named landing place, NOT a harbour boundary - no harbour polygon exists in any source consulted.`,
            source: "https://www.openstreetmap.org/",
            licence: "ODbL",
            sourceVerified: new Date().toISOString().slice(0, 10),
          },
        });
      }

      features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

      const fc = {
        type: "FeatureCollection",
        name: "ports",
        properties: {
          generated: new Date().toISOString(),
          source: "https://www.openstreetmap.org/",
          sourceVerified: new Date().toISOString().slice(0, 10),
          licence: "ODbL",
          statutoryPorts: STATUTORY,
          caveats: CAVEATS,
        },
        features,
      };

      const bytes = writeJSON(OUT, fc, { pretty: true });
      const counts = features.reduce((acc, f) => {
        acc[f.properties.kind] = (acc[f.properties.kind] ?? 0) + 1;
        return acc;
      }, {});
      const stat = features.filter((f) => f.properties.statutoryPort).length;
      const unmapped = features.filter((f) => f.properties.geometryPresent === false).length;
      console.log(`  ports.geojson  ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
      console.log(`    ${stat} statutory ports, ${unmapped} without mapped geometry`);
      console.log(`    ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ")}`);
    })
    .catch((e) => {
      console.error(`ports ingest failed: ${e.message}`);
      process.exit(1);
    });
}

main();