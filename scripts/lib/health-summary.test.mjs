/**
 * Unit tests for the health freshness summary (src/lib/health-summary.ts).
 *
 * Pure date maths, so it runs under `node --test`. A fixed `now` of
 * 2026-10-16 01:50:00Z is used to make the month-day strings unambiguous - the
 * code renders UTC, which matches build timestamps.
 *
 * NOTE: this file is plain JS (.mjs) on purpose - `--experimental-strip-types`
 * applies to the imported .ts sources, but the test file itself must not use
 * TypeScript syntax.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ageInDays,
  formatGenerated,
  summarizeHealth,
} from "../../src/lib/health-summary.ts";

const NOW = new Date("2026-10-16T01:50:00.000Z");

test("ageInDays counts whole days and clamps negative values to 0", () => {
  assert.equal(ageInDays("2026-10-09T01:50:00.000Z", NOW), 7, "exactly 7 days old");
  assert.equal(ageInDays("2026-10-09T01:51:00.000Z", NOW), 6, "less than 7 days into the day round down");
  assert.equal(ageInDays("2026-10-08T01:49:00.000Z", NOW), 8, "just over 7 days");
  assert.equal(ageInDays("2026-10-15T01:50:00.000Z", NOW), 1);
  assert.equal(ageInDays("2026-10-16T01:50:00.000Z", NOW), 0);
  assert.equal(ageInDays("2026-10-17T01:50:00.000Z", NOW), 0, "build from future clamps to 0");
  assert.equal(ageInDays(null, NOW), null);
  assert.equal(ageInDays(undefined, NOW), null);
  assert.equal(ageInDays("not-a-date", NOW), null);
});

test("formatGenerated renders the UTC month-day/time the panel shows", () => {
  assert.equal(formatGenerated("2026-10-16T01:50:01.508Z"), "16 Oct, 01:50");
  assert.equal(formatGenerated("2025-01-05T12:05:00Z"), "05 Jan, 12:05");
  assert.equal(formatGenerated("2026-10-09T00:00:00.000Z"), "09 Oct, 00:00");
  assert.equal(formatGenerated(null), null);
  assert.equal(formatGenerated("nope"), null);
});

test("broken reports take the danger tone first", () => {
  const bad = summarizeHealth({ ok: false, problems: ["worker missing"], warnings: ["old"] }, { now: NOW });
  assert.equal(bad?.tone, "danger");
  assert.equal(bad?.text, "Data problems detected · 1 problem");
  assert.equal(bad?.title, "worker missing");

  const absent = summarizeHealth({ ok: true, absent: ["roads"], problems: [] }, { now: NOW });
  assert.equal(absent?.tone, "danger");
  assert.equal(absent?.text, "Data incomplete · 1 layer without data");
  assert.equal(absent?.title, "roads");

  const fail = summarizeHealth({ ok: false }, { now: NOW });
  assert.equal(fail?.tone, "danger");
  assert.equal(fail?.text, "Data health check failed");

  assert.equal(summarizeHealth(null, { now: NOW }), null);
  assert.equal(summarizeHealth("ok", { now: NOW }), null);
});

test("stale or warned builds fall to warn, with the age mentioned", () => {
  const old = summarizeHealth(
    { ok: true, layers: 43, generated: "2026-10-08T01:50:00.000Z" },
    { now: NOW },
  );
  assert.equal(old?.tone, "warn");
  assert.equal(old?.text, "Data needs attention · generated 8 days ago");
  assert.equal(old?.title, undefined, "no warning string to show in title");

  const warned = summarizeHealth(
    { ok: true, generated: NOW.toISOString(), warnings: ["roads data is old", "heritage slow"] },
    { now: NOW },
  );
  assert.equal(warned?.tone, "warn");
  assert.equal(warned?.text, "Data needs attention · 2 warnings");
  assert.equal(warned?.title, "roads data is old");
});

test("a fresh, healthy build gets the short ok line", () => {
  const ok = summarizeHealth(
    { ok: true, layers: 43, features: 79988, generated: "2026-10-16T01:50:01.508Z" },
    { now: NOW },
  );
  assert.equal(ok?.tone, "ok");
  assert.equal(ok?.text, "Data healthy · 43 layers · generated 16 Oct, 01:50");
  assert.equal(ok?.title, undefined);
});

test("the manifest's generated stamp is used as a fallback for health.json", () => {
  const ok = summarizeHealth(
    { ok: true, layers: 12, warnings: [] },
    { manifestGenerated: "2026-10-16T01:50:00.000Z", now: NOW },
  );
  assert.equal(ok?.tone, "ok");
  assert.equal(ok?.text, "Data healthy · 12 layers · generated 16 Oct, 01:50");

  const old = summarizeHealth(
    { ok: true, layers: 12 },
    { manifestGenerated: "2026-10-09T01:50:00.000Z", now: NOW },
  );
  assert.equal(old?.tone, "warn");
  assert.equal(old?.text, "Data needs attention · generated 7 days ago");
});

test("pluralisation and SLO guard the edge", () => {
  const one = summarizeHealth(
    { ok: true, layers: 1, generated: NOW.toISOString() },
    { now: NOW },
  );
  assert.match(one?.text ?? "", /1 layer/);

  const warned1 = summarizeHealth(
    { ok: true, generated: NOW.toISOString(), warnings: ["only one"] },
    { now: NOW },
  );
  assert.equal(warned1?.text, "Data needs attention · 1 warning");

  const stale1 = summarizeHealth(
    { ok: true, layers: 3, generated: "2026-10-09T01:50:00.000Z" },
    { now: NOW },
  );
  assert.equal(stale1?.tone, "warn");
  assert.match(stale1?.text ?? "", /needs attention/);
  assert.match(stale1?.text ?? "", /7 days ago/);
});
