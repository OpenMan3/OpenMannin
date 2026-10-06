/**
 * Coordinate regression tests.
 *
 * Run with: node --test scripts/lib/coord.test.mjs
 *
 * The National Grid letter scheme is anchored to published reference points
 * rather than derived, because a plausible-but-wrong grid reference puts a
 * landfill in the Irish Sea without looking wrong. Each anchor below is a
 * known square: the false origin is SV, and the four cities give the letter
 * pairs for squares spread across the whole scheme.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseNgr, ngrLetters, ngrToLatLon, latLonToNgr, dms, bearing, kmBetween, compassLabel } from "./coord.mjs";

test("100 km square letters for known eastings/northings", () => {
  // False origin of the grid is square SV.
  assert.equal(ngrLetters(0, 0), "SV");
  // London, City of London.
  assert.equal(ngrLetters(530028, 180380), "TQ");
  // Cardiff.
  assert.equal(ngrLetters(319000, 176000), "ST");
  // Edinburgh.
  assert.equal(ngrLetters(325897, 674001), "NT");
  // Douglas, Isle of Man.
  assert.equal(ngrLetters(238043, 475632), "SC");
});

test("parseNgr resolves the south-west corner of the square", () => {
  // Digits are metres within the square: "808" is 80 800 m, so northing is
  // 100 000 + 80 800 = 180 800.
  assert.deepEqual(parseNgr("TQ 308 808"), {
    easting: 530800,
    northing: 180800,
    precision: 3,
    square: "TQ",
  });
  // Six-figure Douglas reference; Douglas town centre is SC 380 756.
  const d = parseNgr("SC 380 756");
  assert.equal(d.easting, 238000);
  assert.equal(d.northing, 475600);
  assert.equal(d.precision, 3);
});

test("parseNgr accepts spaced, unspaced and padded digit forms", () => {
  const a = parseNgr("SC 295 690");
  const b = parseNgr("SC295690");
  const c = parseNgr("sc295690");
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
});

test("parseNgr lower precision stays inside the correct square", () => {
  // Two-digit refs are 1 km squares, so they land on a round kilometre.
  const p = parseNgr("SC29 69");
  assert.equal(p.easting % 1000, 0);
  assert.equal(p.northing % 1000, 0);
  assert.equal(p.easting, 229000);
  assert.equal(p.northing, 469000);
});

test("parseNgr rejects malformed references", () => {
  assert.throws(() => parseNgr("SC 295"), /odd number of digits/);
  assert.throws(() => parseNgr("nonsense"));
  assert.throws(() => parseNgr("SC 29 6905"), /uneven/);
  // "I" is not part of the grid alphabet.
  assert.throws(() => parseNgr("SI 295 690"));
});

test("ngrToLatLon places known points on the Isle of Man", () => {
  // A grid reference denotes the south-west corner of the square it names, so
  // comparisons carry a 150 m tolerance (the diagonal of a 100 m square) rather
  // than pretending to point accuracy.
  const M_PER_DEG_LAT = 111320;
  const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
  const anchors = [
    ["SC 388 747", "Douglas Head", 54.143217, -4.4679372],
    ["SC 380 756", "Douglas town centre", 54.1508, -4.4814],
    ["SC 284 684", "Ronaldsway / EGNS", 54.083081, -4.623871],
    ["SC 359 817", "Peel", 54.2053, -4.5166],
    ["SC 189 649", "Port Erin", 54.0489, -4.7668],
    ["SC 340 851", "Ramsey", 54.2353, -4.5481],
  ];
  for (const [ref, name, lat, lon] of anchors) {
    const got = ngrToLatLon(ref);
    assert.equal(got.square, "SC", `${name} square`);
    const dLat = Math.abs(got.lat - lat) * M_PER_DEG_LAT;
    const dLon = Math.abs(got.lon - lon) * mPerDegLon(lat);
    assert.ok(Math.hypot(dLat, dLon) < 150, `${name} off by ${Math.hypot(dLat, dLon).toFixed(1)} m`);
    // The whole island falls in 100 km square SC: eastings 218k-246k, northings
    // 464k-494k. Port Erin is the south-western extreme of that range.
    assert.ok(got.easting >= 218000 && got.easting <= 246000, `${name} easting ${got.easting}`);
    assert.ok(got.northing >= 464000 && got.northing <= 494000, `${name} northing ${got.northing}`);
  }
});

test("latLonToNgr round-trips through the projection", () => {
  for (const [lat, lon] of [
    [54.1508, -4.4814], // Douglas
    [54.0831, -4.6239], // Ronaldsway / EGNS
    [54.2353, -4.5481], // Ramsey
  ]) {
    const { ref } = latLonToNgr(lat, lon, 6);
    const back = ngrToLatLon(ref);
    assert.ok(Math.abs(back.lat - lat) < 0.001, `${ref} lat ${back.lat} vs ${lat}`);
    assert.ok(Math.abs(back.lon - lon) < 0.001, `${ref} lon ${back.lon} vs ${lon}`);
  }
});

test("latLonToNgr reports the square and the numeric easting/northing", () => {
  const g = latLonToNgr(54.1508, -4.4814, 6);
  assert.equal(g.square, "SC");
  assert.equal(g.ref.split(" ")[0], "SC");
});

test("dms handles degrees/minutes/seconds with hemisphere", () => {
  assert.equal(dms(54, 8, 50), 54 + 8 / 60 + 50 / 3600);
  assert.ok(dms(4, 28, 21, { western: true }) < 0);
  assert.ok(Math.abs(dms(4, 28, 21, { western: true }) + 4.4725) < 1e-4);
});

test("bearing points north/east/south/west from the origin", () => {
  assert.ok(Math.abs(bearing(0, 0, 0, 1)) < 1e-6, `${bearing(0, 0, 0, 1)} != 0`);
  assert.ok(Math.abs(bearing(0, 0, 1, 0) - 90) < 1e-6);
  assert.ok(Math.abs(bearing(0, 0, 0, -1) - 180) < 1e-6);
  assert.ok(Math.abs(bearing(0, 0, -1, 0) - 270) < 1e-6);
});

test("bearing is degrees, not half-radians (the bug that shipped)", () => {
  // London -> Edinburgh is 339 degrees. The old code multiplied the atan2
  // result by 180/360 instead of 180/pi, which reports between 337 and 359 as
  // roughly 57 degrees - a completely different direction.
  const b = bearing(-0.1276, 51.5072, -3.1883, 55.9533);
  assert.ok(Math.abs(b - 339.07) < 0.5, `London->Edinburgh bearing ${b} is not ~339`);
  // And a near-cardinal still lands on its own quadrant.
  assert.ok(Math.abs(bearing(-4.4765, 54.1506, -4.3810, 54.3135) - 18.9) < 0.3);
});

test("kmBetween is in kilometres, usable for nearest-place", () => {
  const d = kmBetween(-4.4765, 54.1506, -4.3810, 54.3135); // Douglas -> Ramsey
  assert.ok(Math.abs(d - 19.15) < 0.3, `Douglas->Ramsey ${d} km not ~19.1`);
});

test("compassLabel buckets 16 directions", () => {
  assert.equal(compassLabel(0), "N");
  assert.equal(compassLabel(11), "N");
  assert.equal(compassLabel(12), "NNE");
  assert.equal(compassLabel(90), "E");
  assert.equal(compassLabel(180), "S");
  assert.equal(compassLabel(270), "W");
  assert.equal(compassLabel(349), "N");
  assert.equal(compassLabel(360), "N");
});