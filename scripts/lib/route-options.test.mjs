/**
 * Tests for the alternative-route glue (src/lib/navigation/client.ts):
 * assembling a mode's options (fastest first) and resolving a selection.
 *
 * The worker and the map are out of scope; these are the pure steps the host
 * runs when a route arrives and when the reader taps an option, so a wrong
 * order or a missing bounds check would surface here.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  assembleRouteOptions,
  resolveOptionIndex,
} from "../../src/lib/navigation/client.ts";

/** A stand-in RouteLeg with just the fields the glue touches. */
const leg = (distanceM) => ({ distanceM, durationS: distanceM, coordinates: [] });

test("assembleRouteOptions puts the fastest first, then the extras", () => {
  const primary = leg(100);
  const alt = leg(150);
  const opts = assembleRouteOptions(
    { driving: primary, walking: null },
    { driving: [alt] },
  );
  assert.deepEqual(opts.driving, [primary, alt]);
  assert.deepEqual(opts.walking, [], "a mode without a primary has no options");
  assert.deepEqual(opts.cycling, [], "an absent mode is still an empty list");
});

test("assembleRouteOptions with no extras yields just the primary", () => {
  const primary = leg(100);
  const opts = assembleRouteOptions({ driving: primary }, {});
  assert.deepEqual(opts.driving, [primary]);
});

test("resolveOptionIndex accepts a valid move and rejects a no-op", () => {
  assert.equal(resolveOptionIndex(3, 0, 2), 2);
  assert.equal(resolveOptionIndex(3, 2, 1), 1);
  assert.equal(resolveOptionIndex(3, 1, 1), null, "same option is a no-op");
});

test("resolveOptionIndex rejects out-of-range and non-integer requests", () => {
  assert.equal(resolveOptionIndex(2, 0, -1), null);
  assert.equal(resolveOptionIndex(2, 0, 2), null, "== count is out of range");
  assert.equal(resolveOptionIndex(2, 0, 9), null);
  assert.equal(resolveOptionIndex(0, 0, 0), null, "no options, nothing to select");
  assert.equal(resolveOptionIndex(2, 0, 1.5), null);
});
