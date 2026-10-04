/**
 * Coordinate helpers for the ingest scripts.
 *
 * Two conversions the project genuinely needs:
 *
 *  1. `ngrToLatLon` — the Isle of Man Government publishes landfill, power and
 *     cable positions as National Grid references such as "NX 467 044". NGR is
 *     EPSG:27700, the British National Grid on OSGB36, which is roughly 100 m
 *     offset from WGS84 in this area. Putting an NGR straight onto a Web Mercator
 *     basemap silently places features in the wrong place, so the datum shift has
 *     to be applied rather than assumed away.
 *
 *  2. `dms` — Admiralty and MMEA documents give positions as
 *     degrees/minutes/seconds, with west longitudes written as 04° 28' 21" W.
 *
 * The projection is delegated to proj4 rather than hand-rolled: an incorrect
 * transverse Mercator implementation produces plausible-looking but wrong
 * coordinates, which is exactly the failure mode a provenance-first project
 * cannot afford.
 */

import proj4 from "proj4";

// EPSG:4326 WGS84. EPSG:27700 British National Grid is registered explicitly
// from the official PROJ definition: Airy 1830 ellipsoid, transverse Mercator,
// and the published OSGB36-to-WGS84 seven-parameter transform. Spelling the
// parameters out rather than trusting a bundled definition keeps the datum
// shift visible and auditable.
proj4.defs(
  "EPSG:27700",
  "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 " +
    "+ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 " +
    "+units=m +no_defs",
);

const WGS84 = "EPSG:4326";
const OSGB36 = "EPSG:27700";

/**
 * National Grid letter handling.
 *
 * The 100 km squares are a 5x5 block of 500 km squares, and the letter pairs do
 * NOT encode easting and northing independently: both letters depend on the
 * block position, and the eastings/northings are measured from a false origin at
 * grid square SV rather than from square AA, with the northing axis inverted.
 *
 * The implementation below follows Chris Veness' `OsGridRef` (Moveable Type
 * geodesy), which is the reference implementation this project has verified
 * against known anchors: the origin resolves to SV, London (530028, 180380) to
 * TQ, Cardiff (319000, 176000) to ST, Edinburgh (325897, 674001) to NT, and
 * Douglas (238043, 475632) to SC.
 *
 * An earlier hand-rolled version assumed the two letters were independent band
 * offsets and produced plausible-looking but wrong coordinates on the Isle of
 * Man (E 219k-246k, N 467k-494k is the real range). That failure mode is why
 * the projection and the letter scheme are both anchored to published points.
 */

/** ASCII code of "A"; the grid alphabets are contiguous runs of letters. */
const A = "A".charCodeAt(0);

/**
 * Grid square letters for a numeric easting/northing, as a two-letter prefix.
 * Returns only the 100 km square letters; the caller adds the digits.
 */
export function ngrLetters(easting, northing) {
  const e100 = Math.floor(easting / 100000);
  const n100 = Math.floor(northing / 100000);
  let l1 = (19 - n100) - ((19 - n100) % 5) + Math.floor((e100 + 10) / 5);
  let l2 = ((19 - n100) * 5) % 25 + (e100 % 5);
  if (l1 > 7) l1 += 1; // skip the omitted "I"
  if (l2 > 7) l2 += 1;
  return String.fromCharCode(l1 + A, l2 + A);
}

/**
 * Parse a National Grid reference into easting/northing.
 *
 * Accepts "SC 295 690", "SC295690" and the lower-precision "SC29" style.
 * Returns the south-west corner of the referenced square, which is the
 * conventional reading: grid references denote squares, not points, and the
 * precision of the digits says how big the square is.
 */
export function parseNgr(ref) {
  const raw = String(ref).toUpperCase().trim();
  const m = /^([A-Z])([A-Z])\s*(\d+)(?:\s+(\d+))?$/.exec(raw);
  if (!m) throw new Error(`unrecognised National Grid reference: ${ref}`);

  const [, , , digitsA, digitsB] = m;
  if (digitsA === undefined) throw new Error(`National Grid reference has no digits: ${ref}`);
  // "I" is skipped by OSGB convention and must never appear in a grid square.
  if (raw[0] === "I" || raw[1] === "I") throw new Error(`grid letters must not contain "I": ${ref}`);
  let l1 = raw.charCodeAt(0) - A;
  let l2 = raw.charCodeAt(1) - A;
  if (l1 > 7) l1 -= 1; // skip the omitted "I"
  if (l2 > 7) l2 -= 1;
  if (l1 < 0 || l1 > 18 || l2 < 0 || l2 > 18) throw new Error(`bad grid letters in ${ref}`);

  // 100 km square index from the SV false origin.
  const e100 = (((l1 - 2) % 5) + 5) % 5 * 5 + (l2 % 5);
  const n100 = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);

  // Two separated groups are used as-is; a single run is split down the middle.
  let parts;
  if (digitsB !== undefined) {
    parts = [digitsA, digitsB];
  } else {
    if (digitsA.length % 2 !== 0) {
      throw new Error(`odd number of digits in National Grid reference: ${ref}`);
    }
    parts = [digitsA.slice(0, digitsA.length / 2), digitsA.slice(digitsA.length / 2)];
  }
  const [ed, nd] = parts;
  if (ed.length !== nd.length) {
    throw new Error(`uneven easting/northing digits in National Grid reference: ${ref}`);
  }

  // Number of digits per axis sets the resolution; the leading zeros matter.
  const precision = ed.length;
  const easting = e100 * 100000 + Number(ed.padEnd(5, "0"));
  const northing = n100 * 100000 + Number(nd.padEnd(5, "0"));

  return {
    easting,
    northing,
    precision,
    square: raw.slice(0, 2),
  };
}

/** Convert a National Grid reference to WGS84 latitude/longitude. */
export function ngrToLatLon(ref) {
  const { easting, northing, precision, square } = parseNgr(ref);
  const [lon, lat] = proj4(OSGB36, WGS84, [easting, northing]);
  return { lat, lon, easting, northing, precision, square };
}

/**
 * Project WGS84 latitude/longitude to an OSGB36 National Grid reference.
 * `digits` is the total number of numeric digits (6 => 100 m square).
 */
export function latLonToNgr(lat, lon, digits = 6) {
  const [easting, northing] = proj4(WGS84, OSGB36, [lon, lat]);
  const letters = ngrLetters(easting, northing);
  const res = 10 ** (5 - digits / 2);
  const e = String(Math.floor((easting % 100000) / res)).padStart(digits / 2, "0");
  const n = String(Math.floor((northing % 100000) / res)).padStart(digits / 2, "0");
  return { ref: `${letters} ${e} ${n}`, easting, northing, square: letters };
}

/**
 * Admiralty-style degrees/minutes/seconds to decimal degrees.
 * Set `western` for a west longitude (written as 04° 28' 21" W).
 */
export function dms(degPart, minPart, secPart, { western = false } = {}) {
  const v = Number(degPart) + Number(minPart) / 60 + Number(secPart) / 3600;
  return western ? -v : v;
}

export { proj4 };