/**
 * Weather formatting tests.
 *
 * Run with: npm test
 *
 * WHY THESE EXIST. The weather feed is the only live feed here that needs
 * neither a credential nor a permission, so its helpers can be exercised
 * against real captured data at any time. It had no automated coverage, and
 * the formatting is where the bugs were.
 *
 * The specific bug these lock down: Open-Meteo returns wall-clock times in the
 * REQUESTED timezone with no offset suffix, and the forecast line originally
 * compared them against a UTC hour from toISOString(). During British Summer
 * Time that put the whole line an hour out, so the first entry showed a time
 * that had already passed. A forecast that starts in the past still looks like
 * a forecast, which is why it survived a manual look. The same comparison was
 * then rebuilt against the BROWSER's clock, which is wrong by the visitor's
 * offset from the island - the bug moved rather than went away. Both are
 * pinned here by `forecastHourKey`, which always reads Europe/London.
 *
 * DATES ARE EXPLICIT UTC INSTANTS, NOT LOCAL CONSTRUCTORS. `new Date(y, m, d,
 * h)` bakes the test machine's timezone into the fixture, so a suite written
 * that way passes in London and fails in CI on UTC - the exact bug class under
 * test. Every instant below is written as `...Z` and means the London wall
 * clock stated in the comment next to it.
 *
 * Fixtures are real captured responses. `utc_offset_seconds: 3600` in the
 * capture is the live proof of why the comparison has to be zoned.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  compass,
  describeCode,
  forecastHourKey,
  forecastLine,
  n,
  WMO,
} from "../../src/lib/weather.ts";

/** A REAL captured Open-Meteo response, trimmed. utc_offset 3600 = BST. */
const REAL_HOURLY = {
  time: [
    "2026-10-05T00:00", "2026-10-05T01:00", "2026-10-05T02:00", "2026-10-05T03:00",
    "2026-10-05T04:00", "2026-10-05T05:00", "2026-10-05T06:00", "2026-10-05T07:00",
    "2026-10-05T08:00", "2026-10-05T09:00", "2026-10-05T10:00", "2026-10-05T11:00",
    "2026-10-05T12:00", "2026-10-05T13:00", "2026-10-05T14:00", "2026-10-05T15:00",
    "2026-10-05T16:00", "2026-10-05T17:00", "2026-10-05T18:00", "2026-10-05T19:00",
    "2026-10-05T20:00", "2026-10-05T21:00", "2026-10-05T22:00", "2026-10-05T23:00",
  ],
  temperature_2m: [
    15.5, 15.4, 15.2, 15.1, 15.0, 14.9, 14.9, 15.0,
    15.1, 15.3, 15.6, 15.8, 16.0, 16.1, 16.1, 16.2,
    16.3, 16.3, 16.1, 15.8, 15.4, 14.9, 14.3, 13.7,
  ],
  precipitation_probability: [
    0, 0, 7, 10, 10, 12, 14, 14,
    18, 20, 25, 30, 35, 40, 49, 65,
    80, 85, 75, 60, 45, 30, 20, 15,
  ],
};

// ---------------------------------------------------------------------------
// n(): numeric coercion for display
// ---------------------------------------------------------------------------

test("n rounds and keeps zero", () => {
  assert.equal(n(16.34), 16.3);
  assert.equal(n(16.36), 16.4);
  assert.equal(n(16.36, 2), 16.36);
  assert.equal(n(16.367, 2), 16.37);
  assert.equal(n(0), 0, "zero is a value, not an absence");
  assert.equal(n(0.0, 0), 0);
});

test("n returns null rather than printing NaN or null", () => {
  // These all reach the popup as text, so "null" and "NaN" would be shown to a
  // user rather than the field being omitted.
  assert.equal(n(null), null);
  assert.equal(n(undefined), null);
  assert.equal(n(""), null);
  assert.equal(n("abc"), null);
  assert.equal(n(NaN), null);
  assert.equal(n(Infinity), null);
  assert.equal(n({}), null);
});

test("n accepts numeric strings, which the API sometimes sends", () => {
  assert.equal(n("16.3"), 16.3);
  assert.equal(n("0", 0), 0);
});

// ---------------------------------------------------------------------------
// compass()
// ---------------------------------------------------------------------------

test("compass covers all 16 points", () => {
  assert.equal(compass(0), "N");
  assert.equal(compass(22.5), "NNE");
  assert.equal(compass(90), "E");
  assert.equal(compass(180), "S");
  assert.equal(compass(270), "W");
});

test("compass does not fall off the end of its table", () => {
  // The bug this guards: 360 rounds to index 16, and points[16] is undefined.
  // A popup reading "wind  undefined" is worse than no compass at all.
  for (const d of [348, 350, 359, 360, 361, 720, -1]) {
    const c = compass(d);
    assert.ok(c && c.length > 0, `compass(${d}) returned ${c}`);
  }
  assert.equal(compass(360), "N");
  assert.equal(compass(-11.25), "N", "a negative bearing wraps to north");
});

test("compass passes through missing values", () => {
  assert.equal(compass(null), null);
  assert.equal(compass(undefined), null);
  assert.equal(compass(NaN), null);
});

// ---------------------------------------------------------------------------
// The forecast line: the timezone bug
// ---------------------------------------------------------------------------

test("forecast starts at the current island hour, not a past hour", () => {
  // Real payload, request made at 16:47 island time (BST, so 15:47Z). The
  // capture's own utc_offset is 3600, so a UTC-based comparison would pick
  // 15:00 and show an hour that has already gone by.
  const now = new Date("2026-10-05T15:47:00Z"); // 16:47 Europe/London
  const line = forecastLine(REAL_HOURLY, now);
  assert.ok(line, "forecast line should not be null mid-afternoon");
  assert.ok(
    line.startsWith("16:00"),
    `forecast must begin at the current hour, got: ${line}`,
  );
  assert.equal(line.split(" · ").length, 6, "six hours by default");
});

test("forecast uses the island's wall clock across a UTC date boundary", () => {
  // 00:30 island time on the 6th = 23:30Z on the 5th. A UTC comparison would
  // look for 2026-10-05T23 and return a line from yesterday.
  const now = new Date("2026-10-05T23:30:00Z"); // 00:30 Europe/London, Oct 6
  const hourly = {
    time: ["2026-10-05T23:00", "2026-10-06T00:00", "2026-10-06T01:00", "2026-10-06T02:00"],
    temperature_2m: [13.7, 13.5, 13.4, 13.3],
    precipitation_probability: [15, 14, 12, 10],
  };
  const line = forecastLine(hourly, now) ?? "";
  assert.ok(line.startsWith("00:00"), `expected today's midnight hour, got: ${line}`);
  assert.ok(!line.includes("23:00"), "must not include yesterday's last hour");
});

test("forecast ignores the visitor's own timezone", () => {
  // The same instant as 23:00 island time. A browser clock - the bug that
  // replaced the UTC one - would start the line at the visitor's hour instead
  // of the island's, and the API only ever returns island hours. The key must
  // therefore be derived from Europe/London no matter what the host machine
  // thinks the time is, which is what pinning the instants to `Z` proves.
  const now = new Date("2026-10-05T22:00:00Z"); // 23:00 Europe/London
  const line = forecastLine(REAL_HOURLY, now) ?? "";
  assert.ok(
    line.startsWith("23:00"),
    `forecast must begin at the island's current hour, got: ${line}`,
  );
});

test("forecast respects the requested count", () => {
  const now = new Date("2026-10-05T11:00:00Z"); // 12:00 Europe/London
  assert.equal((forecastLine(REAL_HOURLY, now, 3) ?? "").split(" · ").length, 3);
  assert.equal((forecastLine(REAL_HOURLY, now, 1) ?? "").split(" · ").length, 1);
});

test("forecast never runs off the end of the array", () => {
  // Requesting 6 hours with only 2 left must yield 2, not 4 undefined entries.
  const now = new Date("2026-10-05T21:00:00Z"); // 22:00 Europe/London
  const line = forecastLine(REAL_HOURLY, now) ?? "";
  assert.equal(line.split(" · ").length, 2);
  assert.ok(!line.includes("undefined"));
});

test("forecast skips hours with no temperature instead of printing null C", () => {
  const hourly = {
    time: ["2026-10-05T10:00", "2026-10-05T11:00", "2026-10-05T12:00"],
    temperature_2m: [15.6, null, 16.0],
    precipitation_probability: [25, 30, 35],
  };
  const now = new Date("2026-10-05T09:00:00Z"); // 10:00 Europe/London
  const line = forecastLine(hourly, now) ?? "";
  assert.ok(!line.includes("null"), `null leaked: ${line}`);
  assert.ok(!line.includes("undefined"), `undefined leaked: ${line}`);
  assert.equal(line.split(" · ").length, 2);
});

test("forecast omits probability when the API does not supply it", () => {
  // precipitation_probability is optional on the free tier for some cells, and
  // "10:00 15C undefined%" is not acceptable output.
  const hourly = {
    time: ["2026-10-05T10:00", "2026-10-05T11:00"],
    temperature_2m: [15.6, 15.8],
  };
  const line = forecastLine(hourly, new Date("2026-10-05T09:00:00Z")) ?? "";
  assert.ok(!line.includes("undefined"), line);
  assert.ok(!line.includes("%"), "no probability to report means no percentage sign");
});

test("forecast returns null rather than an empty string", () => {
  const now = new Date("2026-10-05T09:00:00Z");
  assert.equal(forecastLine(null, now), null);
  assert.equal(forecastLine(undefined, now), null);
  assert.equal(forecastLine({}, now), null);
  assert.equal(forecastLine({ time: [] }, now), null);
});

test("forecast survives a non-array time field", () => {
  const now = new Date("2026-10-05T09:00:00Z");
  assert.equal(forecastLine({ time: "not-an-array" }, now), null);
  assert.equal(forecastLine({ time: 42 }, now), null);
});

test("forecast still renders when every hour is in the past", () => {
  // A late-evening request against an array that has already ended must not
  // produce an empty popup.
  const hourly = {
    time: ["2026-10-05T01:00", "2026-10-05T02:00"],
    temperature_2m: [15.4, 15.2],
    precipitation_probability: [0, 7],
  };
  const line = forecastLine(hourly, new Date("2026-10-05T22:30:00Z")); // 23:30 island
  assert.ok(line, "should fall back to the first available hour");
  assert.ok((line ?? "").startsWith("01:00"));
});

test("forecastHourKey is Europe/London wall clock, zero-padded", () => {
  // An unpadded "2026-1-5T9" would compare as a string against "2026-01-05T09"
  // and sort wrongly: "9" > "09" is false, but for other values the ordering
  // breaks in ways that are very hard to see.
  assert.equal(forecastHourKey(new Date("2026-01-05T09:00:00Z")), "2026-01-05T09");
  assert.equal(forecastHourKey(new Date("2026-12-31T23:00:00Z")), "2026-12-31T23");
});

test("forecastHourKey applies British Summer Time", () => {
  // 09:00Z in July is 10:00 on the island. Reading the UTC hour here would
  // start the forecast an hour late - the original bug, verbatim.
  assert.equal(forecastHourKey(new Date("2026-07-05T09:00:00Z")), "2026-07-05T10");
});

test("forecastHourKey rolls the DATE over on the island, not in UTC", () => {
  // 23:30Z on 1 July is 00:30 on 2 July in London. The key must say the 2nd:
  // it is compared against API strings that are written in island time, and a
  // UTC date here skips the whole first hour of the island's next day.
  assert.equal(forecastHourKey(new Date("2026-07-01T23:30:00Z")), "2026-07-02T00");
});

// ---------------------------------------------------------------------------
// WMO codes
// ---------------------------------------------------------------------------

test("describes known WMO codes", () => {
  assert.equal(describeCode(0), "Clear");
  assert.equal(describeCode(3), "Overcast");
  assert.equal(describeCode(95), "Thunderstorm");
  assert.equal(describeCode(63), "Moderate rain");
});

test("an unknown WMO code is null, never a wrong label", () => {
  // Guessing here would be worse than saying nothing: a reader seeing "Clear"
  // when the code is unrecognised would be actively misled.
  assert.equal(describeCode(999), null);
  assert.equal(describeCode(-1), null);
  assert.equal(describeCode(null), null);
  assert.equal(describeCode(undefined), null);
  assert.equal(describeCode("banana"), null);
  assert.equal(describeCode(3.4), "Overcast", "a float code still resolves");
});

test("the WMO table has no duplicate descriptions", () => {
  const seen = new Map();
  for (const [code, label] of Object.entries(WMO)) {
    const prior = seen.get(label);
    assert.equal(prior, undefined, `"${label}" is used by both ${prior} and ${code}`);
    seen.set(label, code);
  }
});

test("weather codes round-trip through numeric strings", () => {
  assert.equal(describeCode("0"), "Clear");
  assert.equal(describeCode("95"), "Thunderstorm");
});