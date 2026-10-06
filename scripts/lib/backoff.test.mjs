import test from "node:test";
import assert from "node:assert/strict";
import { nextPollDelayMs, LIVE_POLL_BASE_MS, LIVE_POLL_MAX_MS } from "../../src/lib/feeds/backoff.ts";

test("no failures keeps the normal cadence", () => {
  assert.equal(nextPollDelayMs(0), LIVE_POLL_BASE_MS);
});

test("failures double the delay", () => {
  assert.equal(nextPollDelayMs(1), 60_000);
  assert.equal(nextPollDelayMs(2), 120_000);
  assert.equal(nextPollDelayMs(3), 240_000);
});

test("the delay is capped, not unbounded", () => {
  // 2 ** 10 * 30s = 8.5 hours if unbounded; the cap is 30 minutes.
  assert.equal(nextPollDelayMs(10), LIVE_POLL_MAX_MS);
  assert.equal(nextPollDelayMs(99), LIVE_POLL_MAX_MS);
});

test("a count of zero fails is never below the base", () => {
  assert.equal(nextPollDelayMs(-1), LIVE_POLL_BASE_MS);
});

test("overrides allow a tighter schedule for tests", () => {
  assert.equal(nextPollDelayMs(3, { baseMs: 1000, maxMs: 4000 }), 4000);
});