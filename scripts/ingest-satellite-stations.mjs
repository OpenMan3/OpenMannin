/**
 * Satellite ground stations and GNSS reference stations.
 *
 * Two features, and the small number is the point. It is tempting to plot the
 * handful of visible Starlink dishes and give the layer a satisfying spread, but
 * a layer titled "satellite ground stations" next to a row of confident pins
 * implies a survey of a network that nobody has conducted. Only two sites here
 * have a citable position, so there are two.
 *
 * THE SPACEMAN TELEPORT is the one station whose position has been published:
 * aql Space Services (formerly BlueWave Communications) states 54.1390 N,
 * 4.4951 W, about 2 km east of Douglas. That checks out - the point falls 1.45 km
 * east of Douglas town centre. The site is carrier-neutral, was chosen for low
 * horizon clutter and separately allocated spectrum, and has dark fibre into the
 * aql UK network. The lineage is unusual and matters: SES announced an IoM
 * teleport in September 2016 and withdrew in summer 2021; BlueWave acquired the
 * site around 2020.
 *
 * THE IOMS GNSS REFERENCE STATION at the airport is a different kind of thing
 * entirely - a survey-grade geodetic reference, not a communications downlink -
 * and it is included because it is separately documented in Ordnance Survey Net
 * and Leica SmartNet. Its position is given here as the EGNS aerodrome reference
 * point. That is NOT the station's own surveyed position: nobody publishes where
 * on the airfield the antenna stands, so this is grade C and flagged. Do not use
 * it for anything requiring metre-level accuracy.
 *
 * WHAT IS DELIBERATELY ABSENT:
 *   - Starlink. Licensed on the island via a BlueWave partnership, CURA
 *     confirmed a licence in 2021, but the dish coordinates appear only on
 *     third-party trackers with no operator confirmation. Not plotted.
 *   - Arqiva's "Chalfont" teleport, which is in Buckinghamshire and NOT on the
 *     Isle of Man. A widely repeated Data Center Dynamics claim to the contrary
 *     is wrong, and plotting it here would propagate that error.
 *   - OneWeb, Galileo and BeiDou ground infrastructure, none of which could be
 *     located either way.
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";

const OUT = "public/data/satellite-stations.geojson";

const SPACEMAN = {
  lat: 54.139,
  lon: -4.4951,
  url: "https://spaceman.im/",
  notes:
    "Site lineage: SES announced an IoM teleport in September 2016, withdrew in summer 2021; BlueWave acquired the site around 2020. Now aql Space Services.",
};

const EGNS = {
  lat: 54.083081,
  lon: -4.623871,
  url: "https://www.eurocontrol.int/",
  ref: "EGNS",
};

const CAVEATS = [
  "THIS LAYER HAS TWO FEATURES BECAUSE ONLY TWO SITES HAVE A CITABLE POSITION. It is not a survey of satellite infrastructure on the island, and a sparse layer must not be read as an absence of infrastructure.",
  "STARLINK IS NOT PLOTTED. Starlink is licensed on the island via a BlueWave partnership, with CURA confirming a licence in 2021, but dish coordinates appear only on third-party trackers with no operator confirmation.",
  "Arqiva's 'Chalfont' teleport is in BUCKINGHAMSHIRE, NOT the Isle of Man. A widely repeated Data Center Dynamics claim to the contrary is wrong. It is excluded deliberately.",
  "No OneWeb, Galileo or BeiDou ground infrastructure has been located either way. Absence here is not evidence of absence on the ground.",
  "The IOMS GNSS reference station is positioned at the EGNS aerodrome reference point because the station's own surveyed position is not published. This is accurate to the airfield, NOT to the station. Do not use it for survey-grade work.",
  "Spectrum licensing is administered by CURA. There is no public earth-station licence register for IoM-located sites, so this layer cannot be made exhaustive without operator or regulator cooperation.",
  "Dish positions change. Ground stations are re-pointed, added and decommissioned, and this layer was not resurveyed after its source date.",
];

function main() {
  const features = [
    {
      type: "Feature",
      id: "satellite/spaceman-teleport",
      geometry: roundCoords({ type: "Point", coordinates: [SPACEMAN.lon, SPACEMAN.lat] }, 6),
      properties: {
        name: "Spaceman teleport (aql Space Services)",
        kind: "satellite-teleport",
        operator: "aql Space Services (formerly BlueWave Communications)",
        status: "operational",
        carrierNeutral: true,
        // Verified against the registry claim: 1.45 km east of Douglas centre.
        placementRationale:
          "Selected for low horizon clutter and separately allocated spectrum, with dark fibre into the aql UK network and access to BlueWave masts including the adjacent 40 m CARNANE1 tower.",
        lineage: SPACEMAN.notes,
        coordGrade: "A",
        coordSource: "Position published by the operator.",
        source: SPACEMAN.url,
        licence: "PUBLIC-DOMAIN",
        sourceVerified: "2026-10-04",
        caveats: CAVEATS,
      },
    },
    {
      type: "Feature",
      id: "satellite/ioms-gnss-reference",
      geometry: roundCoords({ type: "Point", coordinates: [EGNS.lon, EGNS.lat] }, 6),
      properties: {
        name: "IOMS GNSS reference station",
        kind: "gnss-reference-station",
        operator: "Isle of Man Survey (IOMS)",
        status: "operational",
        networks: ["Ordnance Survey Net", "Leica SmartNet"],
        purpose:
          "Survey-grade geodetic GNSS reference. This is a positioning reference, NOT a communications downlink, and it is not part of any satellite ground-station network.",
        // The honest part: this is the aerodrome, not the antenna.
        positionNote:
          "Positioned at the EGNS aerodrome reference point. The station's own surveyed position within the airfield is not published.",
        coordGrade: "C",
        coordSource:
          "EGNS aerodrome reference point from OurAirports, used as a proxy for the station position. Accurate to the airfield, not to the antenna.",
        source: EGNS.url,
        secondarySource: "https://www.ordnancesurvey.co.uk/",
        licence: "PUBLIC-DOMAIN",
        sourceVerified: "2026-10-04",
        caveats: CAVEATS,
      },
    },
  ];

  const fc = {
    type: "FeatureCollection",
    name: "satellite-stations",
    properties: {
      generated: new Date().toISOString(),
      source: SPACEMAN.url,
      sourceVerified: "2026-10-04",
      licence: "PUBLIC-DOMAIN",
      completeness:
        "Deliberately incomplete. Two features is the number of sites with a citable position, not the number of sites that exist.",
      caveats: CAVEATS,
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`  satellite-stations.geojson  ${features.length} features, ${(bytes / 1024).toFixed(1)} KB`);
  for (const f of features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    console.log(`    [${p.coordGrade}] ${p.name} — ${p.kind} — ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }
  console.log(`    (Starlink / OneWeb / Galileo / BeiDou not plotted - no citable position)`);
}

main();