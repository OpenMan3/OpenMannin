/**
 * Offshore wind projects in Isle of Man waters.
 *
 * Both projects that appear here are REFUSED or DEAD, and the layer is
 * deliberately shaped around that rather than around a lease footprint.
 *
 * Mooir Vannin (Ørsted) reached the Marine Infrastructure Consent process and
 * its application was closed unconsented on 9 September 2026. It is not
 * operating, not consented, and has no live lease to draw. What is worth
 * mapping is the refusal itself and where the proposal sat, because a proposal
 * that was examined and refused is a materially different fact from one that
 * lapsed unexamined, and because the same site may return.
 *
 * The Crown Estate's Morgan site (1.5 GW, 300 km2, ~36 m depth) had its
 * development discontinued in January 2026 and was retendered in July 2026. No
 * citable position for its footprint could be established, so it is recorded in
 * the registry caveats rather than plotted. Inventing a polygon for it would be
 * exactly the fabricated precision this project exists to avoid.
 *
 * GEOMETRY IS GRADE D AND THAT IS THE HONEST GRADE. Mooir Vannin is positioned
 * by bearing and distance from a documented headland ("6-12 nautical miles off
 * Maughold Head"), projected along a north-east bearing into the Irish Sea. The
 * result is an indicative centroid of an area, not a lease boundary and not a
 * turbine position. It is not default-on, and it should never be used for
 * anything navigational or for siting analysis.
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/offshore-wind.geojson";
const MIMA = "https://www.gov.im/departments/isle-of-man-infrastructure-marine-planning-authority/";
const ORSTED = "https://www.orsted.com/";

/** Maughold Head, the landfall reference the project is described against. */
const MAUGHOLD_HEAD = { lat: 54.2978804, lon: -4.3124657, source: "Nominatim (OSM)" };

const CAVEATS = [
  "GRADE D POSITION. Mooir Vannin's point is an indicative centroid derived from the published bearing and distance ('6-12 nautical miles off Maughold Head') projected north-east into the Irish Sea. It is NOT a lease area, a consent boundary or a turbine position.",
  "THE CONSENT WAS REFUSED. The Marine Infrastructure Consent application closed unconsented on 9 September 2026. Nothing here is operating or consented.",
  "The Crown Estate's Morgan site is NOT PLOTTED. Its development was discontinued in January 2026 and retendered in July 2026, but no citable footprint position could be established.",
  "The Mooir Vannin Agreement for Lease dates from November 2015 and predates the refusal by a decade. A historic Agreement for Lease is not evidence of a live lease.",
  "Do not use for navigation, fisheries, seabed tenure or any siting analysis. If a live proposal is needed, the Marine Institute's current consent register is the only authoritative source.",
];

function offsetPoint(origin, km, bearingDeg) {
  const lat1 = (origin.lat * Math.PI) / 180;
  const lon1 = (origin.lon * Math.PI) / 180;
  const brg = (bearingDeg * Math.PI) / 180;
  const d = km / 6371.0088; // angular distance
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

function main() {
  // Midpoint of the published 6-12 nm band, on a north-east bearing.
  const midNm = 9;
  const midKm = midNm * 1.852;
  const pos = offsetPoint(MAUGHOLD_HEAD, midKm, 45);

  const features = [
    {
      type: "Feature",
      id: "offshore-wind/mooir-vannin",
      geometry: roundCoords({ type: "Point", coordinates: [pos.lon, pos.lat] }, 5),
      properties: {
        name: "Mooir Vannin",
        operator: "Ørsted",
        status: "consent-refused",
        statusDetail:
          "Marine Infrastructure Consent application examined and closed unconsented on 9 September 2026.",
        capacityMW: 1400,
        turbineCount: "up to 100",
        agreementForLease: "November 2015",
        // Exactly how the position was derived, so a reader can reproduce or
        // reject it rather than having to trust it.
        derivation: `Indicative centroid: ${midNm} nm (${midKm.toFixed(1)} km) on a 045° bearing from Maughold Head (${MAUGHOLD_HEAD.lat}, ${MAUGHOLD_HEAD.lon}). The published range is 6-12 nm; the midpoint is used because no lease polygon has been published.`,
        publishedDistanceRangeNm: [6, 12],
        publishedBearing: "off Maughold Head, IoM territorial seas",
        coordGrade: "D",
        coordSource:
          "Derived from a published distance-and-bearing description against a geocoded headland. Indicative area centroid, NOT a lease boundary.",
        referencePoint: `Maughold Head via ${MAUGHOLD_HEAD.source}`,
        source: MIMA,
        secondarySource: ORSTED,
        licence: "PUBLIC-DOMAIN",
        sourceVerified: "2026-10-04",
        caveats: CAVEATS,
      },
    },
  ];

  const fc = {
    type: "FeatureCollection",
    name: "offshore-wind",
    properties: {
      generated: new Date().toISOString(),
      source: MIMA,
      sourceVerified: "2026-10-04",
      licence: "PUBLIC-DOMAIN",
      caveats: CAVEATS,
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`  offshore-wind.geojson  ${features.length} project, ${(bytes / 1024).toFixed(1)} KB`);
  for (const f of features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    console.log(`    [${p.coordGrade}] ${p.name} — ${p.status} — ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }
  console.log(`    (Crown Estate Morgan excluded: no citable footprint position)`);
}

main();