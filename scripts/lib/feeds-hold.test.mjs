/**
 * The three server-backed live feeds are on hold until data agreements are
 * secured. These tests pin that contract: fetchFeed answers with the
 * configuration-state failure and never touches the network, and the poller's
 * source of truth (FEEDS_ON_HOLD) is exactly the server-feed set.
 *
 * Convention: each test FAILS if a held feed is re-enabled.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchFeed,
  FEEDS_ON_HOLD,
  SERVER_SIDE_FEEDS,
  ON_HOLD_REASON,
} from "../../src/lib/feeds/index.ts";

test("held live feeds answer 503 not-enabled, never a network result", async () => {
  for (const id of ["live-flights", "live-vessels", "live-transit"]) {
    const r = await fetchFeed(id);
    assert.equal(r.ok, false, `${id} must never produce a FeatureCollection`);
    assert.equal(r.status, 503);
    assert.equal(r.error, "not-enabled", "a hold is a configuration state, not a fault");
    assert.match(r.reason, /data.*agreement|on hold/i);
  }
});

test("fetchFeed never calls the network for anything in FEEDS_ON_HOLD", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => {
    called = true;
    return Promise.reject(new Error("a held feed must not fetch"));
  };
  try {
    for (const id of FEEDS_ON_HOLD) await fetchFeed(id);
  } finally {
    globalThis.fetch = original;
  }
  assert.ok(!called, "fetch was called for a feed that is supposed to be stubbed out");
});

test("FEEDS_ON_HOLD is exactly the server-feed set", () => {
  assert.deepEqual([...FEEDS_ON_HOLD].sort(), Object.keys(SERVER_SIDE_FEEDS).sort());
});

test("ON_HOLD_REASON names the blocker", () => {
  assert.match(ON_HOLD_REASON, /data-use agreement/i);
});
