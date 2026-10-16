/**
 * Unit tests for the pure pass-summary layer (src/lib/feeds/pass-summary.ts).
 *
 * WHY A TEST FILE RATHER THAN COMPONENT TESTS. The logic that decides what the
 * satellite widget says - which passes count, in what order, and how a rise
 * time becomes a countdown - has no DOM and no network. It is exactly the sort
 * of string/time code that silently breaks across a timezone or a shape
 * change, and `node --test` can pin it down directly. PassWidget itself stays
 * a thin shell over these functions.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts source, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { nextPassLabel, summarizePasses } from "../../src/lib/feeds/pass-summary.ts";

/** Fixed epoch so the assertions do not depend on when the suite runs. */
const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);

/** Builds one worker-shaped feature from flat next-pass fields. */
function feature(name, noradId, riseIso, setIso = riseIso, maxElevDeg = 45, durationS = 600) {
  return {
    type: "Feature",
    properties: { name, noradId, nextRiseIso: riseIso, nextSetIso: setIso, nextMaxElevDeg: maxElevDeg, nextDurationS: durationS },
  };
}

function fc(features, properties = {}) {
  return { type: "FeatureCollection", properties, features };
}

function iso(offsetMin) {
  return new Date(NOW + offsetMin * 60_000).toISOString();
}

test("summarizePasses reads flat next-pass fields and orders by rise", () => {
  const input = fc([
    feature("ISS (ZARYA)", 25544, iso(90), iso(99), 45, 540),
    feature("CSS", 48274, iso(30), iso(38), 72, 480),
  ]);
  const out = summarizePasses(input, NOW);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "CSS");
  assert.equal(out[1].name, "ISS (ZARYA)");
  assert.equal(out[0].noradId, 48274);
  assert.equal(out[0].rise, NOW + 30 * 60_000);
  assert.equal(out[0].set, NOW + 38 * 60_000);
  assert.equal(out[0].maxElevDeg, 72);
  assert.equal(out[0].durationS, 480);
});

test("passes whose rise is before now are filtered out", () => {
  const input = fc([
    feature("LATE", 1, iso(60)),
    feature("EARLY", 2, iso(-30)),
  ]);
  const out = summarizePasses(input, NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "LATE");
});

test("the limit caps the result, defaulting to four", () => {
  const features = [5, 4, 3, 2, 1].map((m) => feature(`SAT-${m}`, m, iso(m * 10)));
  assert.equal(summarizePasses(fc(features), NOW).length, 4, "default limit is 4");
  assert.equal(summarizePasses(fc(features), NOW, 2).length, 2, "explicit limit is honoured");
  assert.equal(summarizePasses(fc(features.slice(0, 2)), NOW, 9).length, 2, "limit above the count is fine");
});

test("malformed collections and features yield [] rather than throwing", () => {
  assert.deepEqual(summarizePasses(null, NOW), []);
  assert.deepEqual(summarizePasses(undefined, NOW), []);
  assert.deepEqual(summarizePasses({}, NOW), []);
  assert.deepEqual(summarizePasses({ features: null }, NOW), []);
  assert.deepEqual(summarizePasses({ features: "nope" }, NOW), []);
  assert.deepEqual(summarizePasses(fc([null, 1, "x", {}, { properties: null }]), NOW), []);
  // Missing or unparseable nextRiseIso is skipped, not fatal.
  assert.deepEqual(summarizePasses(fc([{ properties: { name: "X" } }]), NOW), []);
  assert.deepEqual(summarizePasses(fc([feature("X", 1, "not-a-date")]), NOW), []);
  // A non-finite elevation or duration makes the entry untrustworthy; drop it.
  assert.deepEqual(summarizePasses(fc([feature("X", 1, iso(10), iso(11), NaN, 60)]), NOW), []);
  // A non-finite now is caller error, not a crash.
  assert.deepEqual(summarizePasses(fc([feature("X", 1, iso(10))]), NaN), []);
});

test("nextPassLabel counts down in minutes below an hour", () => {
  assert.equal(nextPassLabel([], NOW), null, "empty list has no label");
  const soon = summarizePasses(fc([feature("ISS (ZARYA)", 25544, iso(42))]), NOW);
  assert.equal(nextPassLabel(soon, NOW), "ISS in 42 min", "first word of the name, minutes");
});

test("nextPassLabel switches to hours past an hour, and to a clock past a day", () => {
  const hours = summarizePasses(fc([feature("CSS", 48274, iso(3 * 60 + 12))]), NOW);
  assert.equal(nextPassLabel(hours, NOW), "CSS in 3 h 12 m");
  const exact = summarizePasses(fc([feature("CSS", 48274, iso(2 * 60))]), NOW);
  assert.equal(nextPassLabel(exact, NOW), "CSS in 2 h");
  // Beyond a day a countdown stops being useful; name the weekday and time.
  const far = summarizePasses(fc([feature("CSS", 48274, iso(5 * 24 * 60 + 90))]), NOW);
  const label = nextPassLabel(far, NOW);
  assert.match(label, /^CSS (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{2}:\d{2}$/, `got "${label}"`);
});
