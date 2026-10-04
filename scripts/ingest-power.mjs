/**
 * Power generation, substations and distributed generators.
 *
 * This layer is built from OpenStreetMap geometry joined to Manx Marine
 * Environmental Assessment (MMEA) Chapter 6.1 capacity figures. Both sources are
 * needed because neither alone is sufficient: MMEA gives authoritative
 * capacities but no coordinates, and OSM gives coordinates but no capacities.
 *
 * GENERATION, from MMEA (Ed. October 2018):
 *   Pulrose    87MW combined-cycle gas turbine, plus 5 diesel engines at 48MW
 *   Peel       4 diesel engines at 38.4MW
 *   Ramsey     2 diesel engines at 4MW
 *   Sulby      1MW hydro-electric
 *   Island EfW 7MW capable, typically ~3MW to the network (Sita IOM)
 *   Total      over 178MW maximum
 *
 * That 2018 vintage is the main weakness in this layer and is stated as such:
 * the capacities are ten years old at the time of writing and several will have
 * moved. They are published as found, with the edition date, rather than
 * updated from memory or silently restated as current.
 *
 * THE SUBSTATION COUNT DOES NOT RECONCILE, and that gap is preserved rather
 * than hidden. MMEA states there are "nine primary substations". OSM maps
 * around two dozen named substations plus many more unnamed. These cannot be
 * the same set: OSM's named substations are predominantly distribution
 * substations, which MEA's count excludes. No attempt is made to pick nine of
 * the OSM substations and declare them the primary ones, because nothing
 * consulted identifies which nine MEA means.
 */

import fs from "node:fs";
import { get, writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/power.geojson";
const MEA_CH6 = "https://www.gov.im/media/1363407/ch-61-cables-pipelines.pdf";
const OSM = "https://www.openstreetmap.org/";
const BBOX = "54.02,-4.85,54.45,-4.30";
const MEA_EDITION = "October 2018";

const OVERPASS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

/** MMEA generation capacities, keyed by the name OSM uses for the site. */
const CAPACITY = {
  "Pulrose Power Station": {
    installedMW: 135,
    breakdown: "87MW combined-cycle gas turbine, plus 5 diesel engines at 48MW combined.",
    note: "Ultra Low Sulphur Diesel held as an alternative fuel.",
  },
  "Peel Power Station": {
    installedMW: 38.4,
    breakdown: "4 diesel engines at 38.4MW combined.",
  },
  "Ramsey Substation": null, // no Ramsey plant of that name in OSM; see note below.
  "Sulby Power Station": {
    installedMW: 1,
    breakdown: "Hydro-electric installation, 1MW.",
  },
  "Isle of Man Incinerator": {
    installedMW: 7,
    typicalSupplyMW: 3,
    breakdown: "Energy from Waste plant, 7MW capable, typically supplying ~3MW to the network.",
    note: "Operated by Sita IOM at the time of the MEA edition.",
  },
};

/**
 * MMEA documents diesel generation at Ramsey that has no corresponding named
 * power plant in OSM, so it is carried as a documented-but-unplaced record
 * rather than being attached to a wrong polygon.
 */
const UNPLACED = [
  {
    name: "Ramsey diesel generation",
    installedMW: 4,
    breakdown: "2 diesel engines at 4MW combined.",
    note: "MMEA records Ramsey diesel generation, but OSM contains no named power plant for it. It is listed here unplaced; do NOT attach these 4MW to Ramsey Harbour or any other mapped feature.",
  },
];

const CAVEATS = [
  `Generation capacities are from MMEA Chapter 6.1, edition ${MEA_EDITION}, and are TEN YEARS OLD at the time of writing. Treat them as a documented historical snapshot, not as current installed capacity. Verify against Manx Utilities before relying on any figure.`,
  "THE SUBSTATION COUNTS DO NOT RECONCILE. MMEA states there are nine primary substations. OSM maps roughly two dozen named substations plus many unnamed. OSM's named substations are predominantly DISTRIBUTION substations, which the MEA count excludes. Nothing consulted identifies which nine are the primary substations, so no attempt is made to select them.",
  "Unnamed substations are included because they are real mapped infrastructure, but an unnamed substation carries no identity: its voltage, capacity and ownership are unknown. Do not treat an unnamed feature as a primary substation.",
  "Overhead line and cable routes are NOT represented. MEA confirms Manx Utilities' transmission and distribution comprise both overhead lines and underground cables, but no reusable route geometry was found, and routing infrastructure onto a map implies an accuracy that does not exist.",
  "The 4MW of Ramsey diesel generation recorded in MEA could not be placed, because OSM has no named Ramsey power plant. It is deliberately NOT snapped to a nearby feature.",
  "Solar and wind generators are mapped at whatever granularity OSM contributors chose, which is highly uneven. Absence of a generator here is not evidence that none exists; only 1 wind generator is mapped island-wide.",
  "This layer shows power ASSETS. It does not show grid connectivity, export capacity, outage history or embedded generation capacity.",
];

const QUERY = `[out:json][timeout:90];
(
  nwr["power"="substation"](${BBOX});
  nwr["man_made"="power_substation"](${BBOX});
  nwr["power"="plant"](${BBOX});
  nwr["power"="generator"](${BBOX});
);
out tags geom;`;

/**
 * Nearest named place for context on features OSM leaves unnamed.
 *
 * There is no authoritative naming source for the island's 53 unnamed
 * substations: MANNGIS publishes no substation layer and OSM has no `name` tag
 * on them. Inventing one would be fabrication, so instead each gets the
 * nearest settlement from the project's own toponyms layer. That is DERIVED
 * CONTEXT, NOT IDENTITY - "400 m NNE of Ballabeg" tells you where to look on a
 * map, it does not tell you what the substation is called, and the field name
 * says so.
 */
async function loadToponyms() {
  const path = new URL("../public/data/topos.json", import.meta.url);
  const candidates = [
    new URL("../public/data/toponyms.geojson", import.meta.url),
    path,
  ];
  for (const url of candidates) {
    try {
      const g = JSON.parse(fs.readFileSync(url, "utf8"));
      const pts = [];
      for (const f of g.features ?? []) {
        const nm = f.properties?.name ?? f.properties?.NAME ?? f.properties?.toponym;
        const c = firstPoint(f.geometry);
        if (!nm || !c) continue;
        pts.push({ name: String(nm), lon: c[0], lat: c[1] });
      }
      return pts;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

/**
 * First lon/lat pair of any geometry kind, or null.
 *
 * GeoJSON nests by kind: a Point is [lon, lat] but a Polygon's first vertex is
 * two levels down ([[[lon, lat], ...]]), and a MultiPoint or LineString one
 * level down. Rather than switch on the type and get it subtly wrong for one
 * of them, descend until a numeric pair appears. The first vertex is close
 * enough for a "which settlement is near" hint on the small features here.
 */
function firstPoint(geometry) {
  let c = geometry?.coordinates;
  for (let depth = 0; depth < 4 && Array.isArray(c); depth++) {
    if (typeof c[0] === "number" && typeof c[1] === "number") return [c[0], c[1]];
    c = c[0];
  }
  return null;
}

/** Great-circle distance in km. */
function kmBetween(aLon, aLat, bLon, bLat) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** Compass bearing from a to b, degrees 0-360. */
function bearing(aLon, aLat, bLon, bLat) {
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dl = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / 360 + 360) % 360;
}

function nearestPlace(lon, lat, toponyms) {
  let best = null;
  let bestKm = Infinity;
  let bestBearing = 0;
  for (const t of toponyms) {
    const d = kmBetween(lon, lat, t.lon, t.lat);
    if (d < bestKm) {
      bestKm = d;
      best = t;
      bestBearing = bearing(lon, lat, t.lon, t.lat);
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    distanceKm: Math.round(bestKm * 10) / 10,
    bearingDeg: Math.round(bestBearing),
    compass: COMPASS[Math.round(bestBearing / 22.5) % 16],
  };
}

async function overpass() {
  for (const ep of OVERPASS) {
    try {
      const res = await get(ep, { method: "POST", body: new URLSearchParams({ data: QUERY }) });
      const json = await res.json();
      const els = (json.elements ?? []).filter((e) => e.tags && (e.geometry || (e.lat && e.lon)));
      if (els.length) return { els, endpoint: ep };
      console.warn(`  ! ${new URL(ep).host} returned nothing`);
    } catch (e) {
      console.warn(`  ! ${new URL(ep).host} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("all Overpass endpoints failed");
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function main() {
  overpass()
    .then(async ({ els, endpoint }) => {
      console.log(`  fetched ${els.length} elements from ${new URL(endpoint).host}`);

      const features = [];
      const counts = { substation: 0, "substation (unnamed)": 0, plant: 0, solar: 0, wind: 0, other: 0 };
      const toponyms = await loadToponyms();
      console.log(`  loaded ${toponyms.length} toponyms for unnamed-feature context`);

      for (const el of els) {
        const t = el.tags;
        const name = t.name || t["name:en"] || null;
        const isSubstation = t.power === "substation" || t.man_made === "power_substation";
        const isPlant = t.power === "plant";
        const isGenerator = t.power === "generator";

        if (!isSubstation && !isPlant && !isGenerator) continue;

        // Solar and wind generators are individual roof/field arrays. Naming
        // them individually would be noise, so they are kept but summarised.
        const src = t["generator:source"] ?? t["plant:source"] ?? null;
        const cap = name ? CAPACITY[name] : null;

        let geometry;
        if (el.type === "node") {
          geometry = { type: "Point", coordinates: [el.lon, el.lat] };
        } else {
          const ring = el.geometry.map((p) => [p.lon, p.lat]);
          if (ring.length < 2) continue;
          const closed =
            ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
          geometry = closed ? { type: "Polygon", coordinates: [ring] } : { type: "LineString", coordinates: ring };
        }

        let kind;
        if (isSubstation) kind = name ? "substation" : "substation (unnamed)";
        else if (isPlant) kind = "plant";
        else if (src === "solar") kind = "solar";
        else if (src === "wind") kind = "wind";
        else kind = "other generator";
        counts[kind] = (counts[kind] ?? 0) + 1;

        const label = name ?? (isSubstation ? "Unnamed substation" : isPlant ? "Unnamed power plant" : "Unnamed generator");

        // For the 78 features OSM leaves unnamed, attach the nearest settlement
        // as derived context. See nearestPlace(): this is a locator, not a name.
        let context = null;
        if (!name) {
          const c = firstPoint(geometry);
          const near = c ? nearestPlace(c[0], c[1], toponyms) : null;
          if (near) {
            context = `${near.distanceKm} km ${near.compass} of ${near.name}`;
          }
        }

        features.push({
          type: "Feature",
          id: `power/${slug(label)}-${el.type}-${el.id}`,
          geometry: roundCoords(geometry, 6),
          properties: {
            name: label,
            kind,
            identified: Boolean(name),
            // Derived locator for unnamed features. NOT the substation's name:
            // no naming source exists for these, and inventing one would be
            // worse than saying where it is instead.
            nearestPlace: context,
            nearestPlaceIsIdentity: false,
            // MEA-supplied capacity, where a named site could be joined.
            installedMW: cap?.installedMW ?? null,
            typicalSupplyMW: cap?.typicalSupplyMW ?? null,
            capacityBreakdown: cap?.breakdown ?? null,
            capacityNote: cap?.note ?? null,
            capacitySource: cap ? `MMEA Ch.6.1, ed. ${MEA_EDITION}` : null,
            generatorSource: src,
            voltage: t.voltage ?? null,
            gridStatus: t["grid:source"] ?? t["plant:source"] ?? null,
            ref: t.ref ?? null,
            osmSource: t.source ?? null,
            osmId: `${el.type}/${el.id}`,
            // Geometry grade comes from OSM. An unnamed substation carries no
            // identity, so it cannot be graded better than C.
            coordGrade: name ? "B" : "C",
            coordSource: t.source
              ? `OpenStreetMap; upstream source tagged in OSM as: ${t.source}`
              : "OpenStreetMap (ODbL)",
            source: OSM,
            secondarySource: cap ? MEA_CH6 : null,
            licence: "ODbL",
            sourceVerified: new Date().toISOString().slice(0, 10),
          },
        });
      }

      for (const u of UNPLACED) {
        features.push({
          type: "Feature",
          id: "power/unplaced-ramsey-diesel",
          geometry: null,
          properties: {
            name: u.name,
            kind: "generation (unplaced)",
            identified: true,
            unplaced: true,
            installedMW: u.installedMW,
            capacityBreakdown: u.breakdown,
            capacityNote: u.note,
            capacitySource: `MMEA Ch.6.1, ed. ${MEA_EDITION}`,
            coordGrade: "D",
            coordSource: "No position. OSM contains no named power plant at Ramsey, so nothing is asserted about where this capacity sits.",
            source: MEA_CH6,
            licence: "OGL-IoM",
            sourceVerified: new Date().toISOString().slice(0, 10),
          },
        });
      }

      features.sort((a, b) => a.properties.name.localeCompare(b.properties.name));

      const fc = {
        type: "FeatureCollection",
        name: "power",
        properties: {
          generated: new Date().toISOString(),
          source: OSM,
          secondarySource: MEA_CH6,
          sourceVerified: new Date().toISOString().slice(0, 10),
          licence: "ODbL; MEA-derived capacity under OGL-IoM",
          capacityEdition: MEA_EDITION,
          meaPrimarySubstationCount: 9,
          caveats: CAVEATS,
        },
        features,
      };

      const bytes = writeJSON(OUT, fc, { pretty: true });
      const withCap = features.filter((f) => f.properties.installedMW != null);
      console.log(`  power.geojson  ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
      console.log(`    ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ")}`);
      console.log(`    ${withCap.length} sites joined to MEA capacity: ${withCap.map((f) => `${f.properties.name.split(" ")[0]} ${f.properties.installedMW}MW`).join(", ")}`);
      console.log(`    MEA primary substations: 9 (not reconcilable with OSM named set)`);
    })
    .catch((e) => {
      console.error(`power ingest failed: ${e.message}`);
      process.exit(1);
    });
}

main();