/**
 * Offshore chemical and ordnance dumpsites — Beaufort's Dyke.
 *
 * Beaufort's Dyke is a glacial tunnel valley in the North Channel of the Irish
 * Sea between Northern Ireland and the Kintyre peninsula. It became the UK's
 * largest offshore dump site after the Second World War, and it is the single
 * most significant maritime dumping ground in British waters.
 *
 * THE GEOMETRY IS A CAREFUL RECONSTRUCTION, NOT A SURVEY, and the distinction
 * matters more here than anywhere else in this project. Ordnance on the seabed
 * is a physical hazard: an indicative polygon invites someone to reason about
 * where it is safe to fish or dredge, so this must not be mistaken for a
 * disposal boundary. Three published facts are combined:
 *
 *   1. OSPAR's dumpsite table lists two separate entries both attributed to
 *      Beaufort's Dyke: entry 16 at 54.9 N, 5.38 W ("1m+ tons dumped by UK.
 *      1160 tons dumped by Ireland") and entry 19 at 54.58 N, 5.08 W ("ditto").
 *      These two points define the disposal axis, and it runs north-west to
 *      south-east as every published description agrees.
 *   2. The published dimensions: 50 km long by 3.5 km wide, 200-312 m deep.
 *   3. The commonly cited centre point, 54.785 N 5.420 W.
 *
 * The corridor below is the axis from the two OSPAR points, extended along its
 * own bearing to the published 50 km length, then given the published 3.5 km
 * width. Everything is grade C and the caveat is repeated in the UI, the data
 * file and the registry entry.
 *
 * Sources: OSPAR Commission assessment of dumped munitions, and the OSPAR
 * Secretariat's inventory of reported dumpsites. Both are cited per feature.
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/dumpsites.geojson";

const OSPAR_ASSESSMENT =
  "https://qsr2010.ospar.org/media/assessments/p00365_Munitions_assessment.pdf";
const OSPAR_INVENTORY = "https://www.ospar.org/documents?v=7021";

/** The two OSPAR inventory entries explicitly attributed to Beaufort's Dyke. */
const OSPAR_POINTS = [
  { osparNo: 16, lat: 54.9, lon: -5.38, detail: "1m+ tons dumped by UK. 1160 tons dumped by Ireland." },
  { osparNo: 19, lat: 54.58, lon: -5.08, detail: "Beaufort's Dyke — as entry 16." },
];

/** Published physical dimensions of the dyke. */
const LENGTH_M = 50_000;
const WIDTH_M = 3_500;

/** The commonly cited centre of the dyke. */
const CENTRE = { lat: 54.785, lon: -5.42 };

const M_PER_DEG_LAT = 111_320;
/** Local flat-earth helpers: over a 50 km feature the curvature error is metres. */
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

/**
 * Build a rectangular corridor polygon along the axis a->b.
 *
 * Endpoints are pushed out along the axis bearing to reach the published total
 * length, then offset by half the published width to each side. The result is a
 * plain rectangle: a dyke is a straight trough, so a curved buffer would imply
 * knowledge of its shape that nobody has.
 */
function corridor(a, b, lengthM, widthM) {
  const latMid = (a.lat + b.lat) / 2;
  const lonScale = mPerDegLon(latMid);

  // Axis as local metres from point a.
  const ax = 0;
  const ay = 0;
  const bx = (b.lon - a.lon) * lonScale;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const axisLen = Math.hypot(bx - ax, by - ay);
  if (axisLen === 0) throw new Error("OSPAR axis points coincide");

  // Unit vector along the axis, and its normal.
  const ux = (bx - ax) / axisLen;
  const uy = (by - ay) / axisLen;
  const nx = -uy;
  const ny = ux;

  // Extend symmetrically to the published total length.
  const extra = Math.max(0, (lengthM - axisLen) / 2);
  const startX = ax - ux * extra;
  const startY = ay - uy * extra;
  const endX = bx + ux * extra;
  const endY = by + uy * extra;

  const half = widthM / 2;
  // Corner offsets: start-left, start-right, end-right, end-left.
  const corners = [
    [startX + nx * half, startY + ny * half],
    [startX - nx * half, startY - ny * half],
    [endX - nx * half, endY - ny * half],
    [endX + nx * half, endY + ny * half],
  ];

  const toLonLat = ([x, y]) => [a.lon + x / lonScale, a.lat + y / M_PER_DEG_LAT];
  const ring = corners.map(toLonLat);
  ring.push(ring[0]); // close the polygon explicitly
  return { ring, axisLen, bearing: (Math.atan2(uy, ux) * 180) / Math.PI };
}

function main() {
  const a = OSPAR_POINTS[0];
  const b = OSPAR_POINTS[1];
  const { ring, axisLen, bearing } = corridor(a, b, LENGTH_M, WIDTH_M);

  const CAVEATS = [
    "THIS POLYGON IS AN INDICATIVE CORRIDOR, NOT A SURVEYED DISPOSAL BOUNDARY. It is reconstructed from two OSPAR inventory points, the published 50 km x 3.5 km dimensions and the cited centre point. It must NOT be used to determine whether a location is safe to fish, dredge, anchor or lay cable.",
    "Extent is deliberately coarse. The 1996 Aberdeen Marine Laboratory survey (FRS 1996) found munitions and munitions-related materials at high densities OUTSIDE the charted dumpsite, so the real distribution is wider than any published boundary can express.",
    "The OSPAR inventory itself flags dumpsite locations as uncertain: 'one of the major difficulties in managing the risk associated with dumpsites is the uncertainty associated with their location'.",
    "The UK MoD lost most disposal records, disclosed April 2020. Completeness is therefore unestablished rather than disproved.",
    "Operation Buffalo and Hurricane were AUSTRALIAN nuclear weapons tests, not British, and not at this site. Beaufort's Dyke received ordnance and chemical-agent DUMPING. Do not attribute weapons testing here.",
    "A 1996 survey found no chemical agent or munitions-derived contaminants adjacent to the dyke in sediment, fish or shellfish. That is reassuring, not exculpatory, given the record loss.",
  ];

  const features = [
    {
      type: "Feature",
      id: "dumpsite/beauforts-dyke",
      geometry: roundCoords({ type: "Polygon", coordinates: [ring] }, 5),
      properties: {
        name: "Beaufort's Dyke",
        kind: "chemical-ordnance-dumpsite",
        status: "discontinued",
        // The corridor as reconstructed, and what it is reconstructed from.
        reconstructedFrom: `OSPAR inventory entries ${a.osparNo} and ${b.osparNo}, extended to the published ${LENGTH_M / 1000} km length and widened to the published ${WIDTH_M / 1000} km width.`,
        axisLengthFromOsparPointsM: Math.round(axisLen),
        axisBearingDeg: Number(bearing.toFixed(1)),
        centreLat: CENTRE.lat,
        centreLon: CENTRE.lon,
        publishedLengthM: LENGTH_M,
        publishedWidthM: WIDTH_M,
        depthRangeM: [200, 312],
        // Quantities as published, with the disagreement between sources kept
        // visible rather than averaged away.
        munitionsTonnage:
          "over 1 million tonnes conventional and chemical munitions (MoD estimate, OSPAR); some sources cite up to 2 million tonnes including short-dumped material",
        chemicalAgents:
          "ca 14,500 t of 5-inch artillery rockets filled with phosgene dumped July 1945; a further ca 14,000 t of phosgene loose-dumped 1946-47",
        radioactiveWaste: "ca 2 tonnes of low-level radioactive waste in concrete-encased drums, authorised in the 1950s-60s",
        dumpingClosed: "Under the London and Oslo Conventions, 1972; last dumping ca 1976",
        coordGrade: "C",
        coordSource:
          "Reconstructed corridor from two OSPAR dumpsite inventory coordinates plus published dimensions. Not a survey.",
        source: OSPAR_INVENTORY,
        secondarySource: OSPAR_ASSESSMENT,
        licence: "PUBLIC-DOMAIN",
        sourceVerified: "2026-10-04",
        caveats: CAVEATS,
      },
    },
    {
      type: "Feature",
      id: "dumpsite/beauforts-dyke-axis",
      geometry: roundCoords(
        {
          type: "LineString",
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
        5,
      ),
      properties: {
        name: "Beaufort's Dyke disposal axis",
        kind: "dumpsite-axis",
        description:
          "The two OSPAR inventory coordinates that define the disposal axis of the dyke. Shown as a line because it is the only part of the reconstruction that rests on published point data rather than derived geometry.",
        fromOsparEntry: `${a.osparNo} (${a.lat} N, ${Math.abs(a.lon)} W)`,
        toOsparEntry: `${b.osparNo} (${b.lat} N, ${Math.abs(b.lon)} W)`,
        coordGrade: "B",
        coordSource: "Directly from the OSPAR dumpsite inventory table.",
        source: OSPAR_INVENTORY,
        licence: "PUBLIC-DOMAIN",
        sourceVerified: "2026-10-04",
        caveats: CAVEATS,
      },
    },
  ];

  const fc = {
    type: "FeatureCollection",
    name: "dumpsites",
    properties: {
      generated: new Date().toISOString(),
      source: OSPAR_INVENTORY,
      secondarySource: OSPAR_ASSESSMENT,
      sourceVerified: "2026-10-04",
      licence: "PUBLIC-DOMAIN",
      caveats: CAVEATS,
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`  dumpsites.geojson  ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
  const p = features[0].properties;
  console.log(
    `    [${p.coordGrade}] ${p.name} — ${(p.publishedLengthM / 1000)} x ${(p.publishedWidthM / 1000)} km corridor, axis ${p.axisBearingDeg}°, centre ${p.centreLat} N ${Math.abs(p.centreLon)} W`,
  );
  console.log(`    [B] ${features[1].properties.name} — from OSPAR entries 16 and 19`);
}

main();