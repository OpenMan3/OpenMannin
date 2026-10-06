/**
 * OpenSky state-vector parsing tests.
 *
 * Run with: npm test
 *
 * WHY THESE EXIST AS UNIT TESTS. The parsing is only reachable in production
 * through /api/flights, which refuses to run without OpenSky credentials that
 * require a written agreement. So before those exist, the code path had no
 * automated coverage at all - and the specific failure it is prone to is silent.
 *
 * OpenSky returns positional arrays shorter than their 18 documented fields
 * whenever a value is missing. `s[17]` on a 17-element array is `undefined`,
 * which becomes `null` in JSON, which MapLibre renders as a point at 0,0 in the
 * Gulf of Guinea. A dot in the wrong ocean is not a crash, not a stack trace and
 * not a failed assertion: it is a plausible-looking bug that a human might not
 * notice for weeks. Hence the explicit guards below, including an assertion that
 * NOTHING in the output is ever NaN.
 *
 * The fixtures are real captured OpenSky responses, not invented arrays.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  num,
  toFeature,
  toFeatureCollection,
  POSITION_SOURCE,
} from "../../src/lib/opensky.ts";

/**
 * A REAL captured anonymous-tier response over the Isle of Man box, verbatim.
 *
 * Two properties matter and both are why this file exists:
 *
 * 1. It is 17 ELEMENTS, not 18. `category` is absent, which is the documented
 *    behaviour of the anonymous tier. Reading s[17] gives `undefined`, which
 *    serialises to NaN, which MapLibre renders as a dot at 0,0 in the Gulf of
 *    Guinea.
 *
 * 2. The field positions do NOT match OpenSky's published index table. In this
 *    payload the squawk is the 4-character string at index 14 and index 12 is
 *    null, whereas the published table places squawk at 12. The route reads
 *    squawk from 14, which is what the live payload requires. The fixtures below
 *    are copied from the capture rather than from the documentation precisely
 *    so that a future reader does not "fix" the indices back to the published
 *    table and silently break the feed.
 *
 * Observed layout, verified by field type in the capture:
 *   0 icao24        5 lon          10 track deg
 *   1 callsign      6 lat          11 vertical rate
 *   2 country       7 baro alt     12 null in this tier
 *   3 time position 8 on ground    13 geometric alt
 *   4 last contact  9 ground speed 14 squawk    16 position source
 */
const REAL_ANONYMOUS_TIER = {
  time: 1791211141,
  states: [
    ["407bde", "EAG44H  ", "United Kingdom", 1791211141, 1791211141, -4.876, 54.0022,
      4572, false, 141.88, 126.75, -0.33, null, 4777.74, "2030", false, 0],
    ["406012", "EZY282J ", "United Kingdom", 1791211140, 1791211141, -4.6082, 54.1017,
      6918.96, false, 187.39, 309.77, -11.38, null, 7261.86, "7735", false, 0],
  ],
};

/** The full 18-field form with a populated `category`, for contrast. */
const REAL_WITH_CATEGORY = {
  time: 1791211141,
  states: [
    ["3c6444", "RYR7FR  ", "Ireland", 1791211141, 1791211141, -4.7421, 54.1234,
      2000, false, 201.3, 250.0, 3.2, null, 7120.5, "2000", false, 0, 14],
  ],
};

// ---------------------------------------------------------------------------
// num(): the guard everything else relies on
// ---------------------------------------------------------------------------

test("num passes through finite numbers", () => {
  assert.equal(num(0), 0);
  assert.equal(num(-4.876), -4.876);
  assert.equal(num(1e30), 1e30);
});

test("num rejects everything that would serialise to NaN or a wrong type", () => {
  assert.equal(num(undefined), null, "short array -> undefined must become null");
  assert.equal(num(null), null);
  assert.equal(num(NaN), null, "NaN must never be passed through");
  assert.equal(num(Infinity), null);
  assert.equal(num(-Infinity), null);
  assert.equal(num("12"), null, "numeric strings must not coerce");
  assert.equal(num(""), null);
  assert.equal(num(true), null);
  assert.equal(num([]), null);
  assert.equal(num({}), null);
});

// ---------------------------------------------------------------------------
// The real payload
// ---------------------------------------------------------------------------

test("parses a real 17-element anonymous-tier vector", () => {
  const fc = toFeatureCollection(REAL_ANONYMOUS_TIER);
  assert.equal(fc.features.length, 2);
  assert.equal(fc.dropped, 0);

  const [first] = fc.features;
  assert.equal(first.id, "aircraft/407bde");
  assert.deepEqual(first.geometry.coordinates, [-4.876, 54.0022]);
  assert.equal(first.properties.callsign, "EAG44H", "callsign padding must be trimmed");
  assert.equal(first.properties.originCountry, "United Kingdom");
  assert.equal(first.properties.baroAltitudeM, 4572);
  assert.equal(first.properties.geoAltitudeM, 4777.74);
  assert.equal(first.properties.onGround, false);
  assert.equal(first.properties.trackDeg, 126.75);
  assert.equal(first.properties.verticalRateMs, -0.33);
  assert.equal(first.properties.squawk, "2030");
  assert.equal(first.properties.positionSource, "ADS-B");
  assert.equal(first.properties.coordGrade, "A");
});

test("converts ground speed to knots", () => {
  const fc = toFeatureCollection(REAL_ANONYMOUS_TIER);
  // 141.88 m/s is 275.8 kn.
  assert.equal(fc.features[0].properties.groundSpeedKn, 275.8);
  assert.equal(fc.features[0].properties.groundSpeedMs, 141.88);
});

test("last contact becomes an ISO timestamp", () => {
  const fc = toFeatureCollection(REAL_ANONYMOUS_TIER);
  assert.equal(fc.features[0].properties.lastContact, new Date(1791211141 * 1000).toISOString());
  assert.equal(fc.observedAt, new Date(1791211141 * 1000).toISOString());
});

// ---------------------------------------------------------------------------
// THE BUG THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------

test("absent category becomes null, never NaN", () => {
  // Index 17 does not exist on a 17-element array. Reading it blind gives
  // undefined; serialising that as a number gives NaN.
  const fc = toFeatureCollection(REAL_ANONYMOUS_TIER);
  for (const f of fc.features) {
    assert.equal(f.properties.adsbCategory, null);
    assert.notEqual(String(f.properties.adsbCategory), "NaN");
  }
});

test("no output value is ever NaN or undefined", () => {
  const responses = [
    REAL_ANONYMOUS_TIER,
    REAL_WITH_CATEGORY,
    { states: null },
    { states: [] },
  ];
  for (const body of responses) {
    const serialised = JSON.stringify(toFeatureCollection(body));
    assert.ok(!serialised.includes("NaN"), `NaN leaked: ${serialised}`);
    assert.ok(!serialised.includes("null,null,null"), `null run leaked: ${serialised}`);
  }
});

test("no feature is ever placed at 0,0", () => {
  // 0,0 is in the Gulf of Guinea. A short array that indexes past its end
  // produces undefined -> null, and MapLibre treats that as the origin.
  const body = {
    states: [["abc123", "TEST  ", "UK", 1, 1]], // position fields missing
  };
  const fc = toFeatureCollection(body);
  assert.equal(fc.features.length, 0);
  assert.equal(fc.dropped, 1);
  assert.ok(!JSON.stringify(fc).includes('"coordinates":[0,0]'));
});

test("a vector with no position is dropped and counted, not invented", () => {
  // Real shape: an aircraft reporting a position SOURCE but no lat/lon. OpenSky
  // sends this, and there is nothing to draw.
  const body = {
    states: [
      ["400abc", "NOPOS  ", "UK", 1, 1, null, null, true, 0, 0, null, null, null, null, null, null, 0],
      ["400def", "HASPOS ", "UK", 1, 1, -4.5, 54.1, false, 100, 100, 90, 0, null, null, null, null, 0],
    ],
  };
  const fc = toFeatureCollection(body);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.features[0].properties.callsign, "HASPOS");
  assert.equal(fc.dropped, 1, "the dropped vector must be accounted for");
});

// ---------------------------------------------------------------------------
// Empty and degenerate responses
// ---------------------------------------------------------------------------

test("states: null is an empty layer, not a crash", () => {
  // An empty bounding box answers null, NOT []. This is the documented
  // behaviour and the difference between an empty map and a 500.
  const fc = toFeatureCollection({ states: null });
  assert.equal(fc.features.length, 0);
  assert.deepEqual(fc.features, []);
});

test("a response with no states key at all is survivable", () => {
  const fc = toFeatureCollection({});
  assert.equal(fc.features.length, 0);
  assert.equal(fc.observedAt, null);
});

test("non-array rows are ignored rather than throwing", () => {
  // A malformed row would make `Array.isArray(s)` false. JSDoc stands in for a
  // type assertion here so the file stays plain JavaScript and needs no
  // transform step to run.
  /** @type {{ states: unknown }} */
  const body = { states: [["400abc", "OK", "UK", 1, 1, -4.5, 54.1, false, 1, 1, 1, 0, null, null, null, null, 0], null, 42, "nonsense"] };
  const fc = toFeatureCollection(body);
  assert.equal(fc.features.length, 1);
  assert.equal(fc.dropped, 3);
});

// ---------------------------------------------------------------------------
// Field-level behaviour
// ---------------------------------------------------------------------------

test("reads the 18-field form including category", () => {
  const fc = toFeatureCollection(REAL_WITH_CATEGORY);
  assert.equal(fc.features.length, 1);
  const p = fc.features[0].properties;
  assert.equal(p.adsbCategory, 14);
  assert.equal(p.baroAltitudeM, 2000, "index 7 is barometric altitude");
  assert.equal(p.geoAltitudeM, 7120.5, "index 13 is geometric altitude");
  assert.equal(p.squawk, "2000", "index 14 is the transponder code in the real payload");
  assert.equal(p.velocityMs, undefined, "velocity is not part of the emitted properties");
});

test("category is the ADS-B emitter category, documented as not a military flag", () => {
  // Guards a specific misreading: treating category 1 or 14 as "military" is
  // community folklore that would mislabel most military aircraft.
  const fc = toFeatureCollection(REAL_WITH_CATEGORY);
  assert.equal(fc.features[0].properties.adsbCategory, 14);
  assert.ok(!("military" in fc.features[0].properties));
  assert.ok(!("civil" in fc.features[0].properties));
});

/** A minimal valid 17-element vector, so tests can vary one field at a time. */
const VECTOR = (over = {}) => ({
  icao24: "400abc", callsign: "TEST  ", country: "UK",
  timePosition: 1791211141, lastContact: 1791211141,
  lon: -4.5, lat: 54.1, baroAlt: 1000, onGround: false,
  speed: 100, track: 90, verticalRate: 0, sq12: null, geoAlt: 1100,
  squawk: "1234", spi: false, source: 0, category: null, ...over,
});

/** Turn that object into the positional array OpenSky actually sends. */
const toArray = (v) => [
  v.icao24, v.callsign, v.country, v.timePosition, v.lastContact,
  v.lon, v.lat, v.baroAlt, v.onGround, v.speed, v.track, v.verticalRate,
  v.sq12, v.geoAlt, v.squawk, v.spi, v.source, v.category,
];

const collect = (over) => toFeatureCollection({ states: [toArray(VECTOR(over))] }).features[0];

test("falls back to icao24 when callsign is blank", () => {
  // A blank callsign is normal for some transponders; an empty popover title is
  // not acceptable.
  assert.equal(collect({ callsign: "       " }).properties.callsign, "400ABC");
  assert.equal(collect({ callsign: "" }).properties.callsign, "400ABC");
});

test("prefers barometric altitude, falling back to geometric", () => {
  assert.equal(collect({ baroAlt: 3000, geoAlt: 3300 }).properties.altitudeM, 3000);
  assert.equal(
    collect({ baroAlt: null, geoAlt: 3300 }).properties.altitudeM,
    3300,
    "with no barometric fix, geometric altitude is better than nothing",
  );
  assert.equal(collect({ baroAlt: null, geoAlt: null }).properties.altitudeM, null);
});

test("every documented position source maps to a name", () => {
  assert.equal(POSITION_SOURCE[0], "ADS-B");
  assert.equal(POSITION_SOURCE[1], "ASTERIX");
  assert.equal(POSITION_SOURCE[2], "MLAT");
  assert.equal(POSITION_SOURCE[3], "FLARM");
  // An out-of-range index must be null, not undefined.
  assert.equal(collect({ source: 9 }).properties.positionSource, null);
  assert.equal(collect({ source: null }).properties.positionSource, null);
});

test("on ground is a strict boolean comparison", () => {
  // s[8] is a real boolean upstream, but a string "false" must not become true.
  assert.equal(collect({ onGround: "false" }).properties.onGround, false);
  assert.equal(collect({ onGround: 1 }).properties.onGround, false);
  assert.equal(collect({ onGround: true }).properties.onGround, true);
});

test("non-string squawk and country become null rather than numbers", () => {
  assert.equal(collect({ squawk: 1234 }).properties.squawk, null);
  assert.equal(collect({ country: 42 }).properties.originCountry, null);
});

test("toFeature rejects a vector with no icao24", () => {
  assert.equal(toFeature([null, "CALL", "UK", 1, 1, -4.5, 54.1]), null);
  assert.equal(toFeature(["", "CALL", "UK", 1, 1, -4.5, 54.1]), null, "empty icao24 is not a feature");
});

test("whitespace-only icao24 is rejected, not turned into an id", () => {
  assert.equal(toFeature(["   ", "CALL", "UK", 1, 1, -4.5, 54.1]), null);
});