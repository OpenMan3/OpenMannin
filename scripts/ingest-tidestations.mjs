/**
 * Tide gauges around the Isle of Man.
 *
 * Source: Manx Marine Environmental Assessment (MMEA), Chapter 2.1 - Physical
 * Environment, 2nd edition, October 2018. The tide-gauge table in section
 * "Tide Gauges" gives a surveyed latitude, longitude and datum relationship for
 * each of the six gauges operated around the Island. MMEA is published by the
 * Isle of Man Government under the Open Government Licence, so the positions
 * and datum values are reusable with attribution.
 *
 * These are grade A coordinates. They are not a place-name geocode and not a
 * rounded figure: each is the published position of a surveyed instrument,
 * transcribed from the table rather than eyeballed. Douglas, for example, is
 * 54°08'50"N 04°28'21"W, which is the harbour gauge and not Douglas Head or the
 * town centre, and the distinction is worth a few hundred metres of accuracy.
 *
 * Vertical datum is recorded per gauge because it is not uniform. All gauges
 * are referenced to the island's GPS datum 'Douglas02', and each gauge's local
 * Tide Gauge Datum is given as an offset from it, so `admiraltyChartDatumM`
 * is the height of Admiralty Chart Datum relative to Douglas02. Douglas, Ramsey,
 * Peel, Port St Mary and Castletown all sit at 0.00 m gauge datum; Port Erin is
 * the exception at +6.32 m, because its gauge is a bubbler system referenced
 * through a mid-tide pressure outlet rather than a mid-tide sensor level.
 *
 * What is deliberately NOT included: the tidal range and tidal characteristic
 * figures elsewhere in MMEA are supplied by the Proudman Institute and carry
 * their own terms, so they are excluded from this dataset. See the registry gap
 * for tidal ranges rather than smuggling them in under the IoM licence.
 */

import { writeJSON, roundCoords } from "./lib/fetch.mjs";
import { dms } from "./lib/coord.mjs";

const OUT = "public/data/tide-stations.geojson";
const MEA_CH2 = "https://www.gov.im/media/1363407/ch-21-physical-environment.pdf";
const MEA_HOME = "https://www.gov.im/";

/**
 * The six gauges, transcribed from the MMEA Chapter 2.1 tide-gauge table.
 *
 * dms(deg, min, sec, {western}) converts the published sexagesimal position;
 * keeping the degrees/minutes/seconds in the output as well means a reader can
 * check the transcription against the PDF without redoing the arithmetic.
 */
const GAUGES = [
  {
    name: "Douglas",
    latDms: [54, 8, 50],
    lonDms: [4, 28, 21],
    western: true,
    tideGaugeDatumM: 0.0,
    datumNote: "Mid-tide sensor level",
    admiraltyChartDatumM: -3.77,
  },
  {
    name: "Ramsey",
    latDms: [54, 19, 7],
    lonDms: [4, 22, 19],
    western: true,
    tideGaugeDatumM: 0.0,
    datumNote: "Mid-tide sensor level",
    admiraltyChartDatumM: -3.94,
  },
  {
    name: "Peel",
    latDms: [54, 13, 35],
    lonDms: [4, 41, 43],
    western: true,
    tideGaugeDatumM: 0.0,
    datumNote: "Mid-tide sensor level",
    admiraltyChartDatumM: -3.03,
  },
  {
    name: "Port Erin",
    latDms: [54, 5, 6],
    lonDms: [4, 46, 1],
    western: true,
    tideGaugeDatumM: 6.32,
    datumNote: "Mid-tide pressure outlet +0.01 m (re-Douglas02)",
    admiraltyChartDatumM: -3.03,
  },
  {
    name: "Port St Mary",
    latDms: [54, 4, 15],
    lonDms: [4, 43, 58],
    western: true,
    tideGaugeDatumM: 0.0,
    datumNote: "Mid-tide sensor level",
    admiraltyChartDatumM: -3.32,
  },
  {
    name: "Castletown",
    latDms: [54, 4, 22],
    lonDms: [4, 38, 53],
    western: true,
    tideGaugeDatumM: 0.0,
    datumNote: "Mid-tide sensor level",
    admiraltyChartDatumM: -3.87,
  },
];

function main() {
  const features = GAUGES.map((g) => {
    const lat = dms(g.latDms[0], g.latDms[1], g.latDms[2]);
    const lon = dms(g.lonDms[0], g.lonDms[1], g.lonDms[2], { western: g.western });
    const slug = g.name.toLowerCase().replace(/\s+/g, "-");

    return {
      type: "Feature",
      id: `tide-gauge/${slug}`,
      geometry: roundCoords({ type: "Point", coordinates: [lon, lat] }, 6),
      properties: {
        name: g.name,
        kind: "tide-gauge",
        latitudeDms: `${g.latDms[0]}°${String(g.latDms[1]).padStart(2, "0")}'${String(g.latDms[2]).padStart(2, "0")}"N`,
        longitudeDms: `${g.lonDms[0]}°${String(g.lonDms[1]).padStart(2, "0")}'${String(g.lonDms[2]).padStart(2, "0")}"W`,
        verticalDatum: "Douglas02",
        // Height of each datum relative to the island's Douglas02 GPS datum.
        tideGaugeDatumM: g.tideGaugeDatumM,
        tideGaugeDatumNote: g.datumNote,
        admiraltyChartDatumM: g.admiraltyChartDatumM,
        operator: "Isle of Man Department of Infrastructure",
        coordGrade: "A",
        coordSource:
          "Surveyed gauge position published in MMEA Chapter 2.1 (IoM Government, Open Government Licence), transcribed from the tide-gauge table.",
        source: MEA_CH2,
        licence: "OGL-IoM",
        sourceVerified: "2018-10-01",
      },
    };
  });

  const fc = {
    type: "FeatureCollection",
    name: "tide-stations",
    properties: {
      generated: new Date().toISOString(),
      source: MEA_CH2,
      sourceVerified: "2018-10-01",
      licence: "OGL-IoM",
      caveats: [
        "Positions are the 2018 MMEA publication; gauges may have been relocated or re-surveyed since.",
        "Vertical datums differ by gauge. Port Erin's gauge datum is +6.32 m relative to Douglas02 because it is a bubbler system referenced through a mid-tide pressure outlet; the other five are at 0.00 m.",
        "Tidal range and tidal characteristic figures are NOT included: those in MMEA are supplied by the Proudman Institute under separate terms.",
        "MMEA Figure 14 is captioned 'Laxey not currently installed', so Laxey appears in no gauge list here even though a weather station of that name exists.",
      ],
      excludedSource: MEA_HOME,
    },
    features,
  };

  const bytes = writeJSON(OUT, fc, { pretty: true });
  console.log(`  tide-stations.geojson  ${features.length} gauges, ${(bytes / 1024).toFixed(1)} KB`);
  for (const f of features) {
    const p = f.properties;
    console.log(
      `    [${p.coordGrade}] ${p.name.padEnd(13)} ${p.latitudeDms} ${p.longitudeDms}  ACD ${p.admiraltyChartDatumM} m`,
    );
  }
}

main();