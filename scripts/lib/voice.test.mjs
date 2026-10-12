/**
 * Unit tests for voice guidance phrases (src/lib/navigation/voice.ts).
 *
 * Pure string building over the same step objects steps.ts produces, so it runs
 * under `node --test` with plain JS (no TypeScript syntax in this file).
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  ARRIVAL_SPEECH,
  spokenApproach,
  spokenDeparture,
  spokenDistance,
  spokenManeuver,
} from "../../src/lib/navigation/voice.ts";

function step(instruction) {
  return {
    instruction,
    distanceM: 100,
    bearing: 90,
    streetName: "Main Street",
    maneuver: "right",
    side: "right",
  };
}

test("spokenDistance expands units and singulars", () => {
  assert.equal(spokenDistance(30), "100 feet");
  assert.equal(spokenDistance(300), "330 yards");
  assert.equal(spokenDistance(1200), "0.7 miles");
  assert.equal(spokenDistance(0), "10 feet");
});

test("spokenManeuver strips the leg-length tail", () => {
  assert.equal(spokenManeuver(step("Turn right onto Main Street for 168 yd")), "Turn right onto Main Street");
  assert.equal(spokenManeuver(step("Turn right, heading east for 168 yd")), "Turn right, heading east");
  assert.equal(spokenManeuver(step("Head north on Cathedral Road for 240 yd")), "Head north on Cathedral Road");
  assert.equal(spokenManeuver(step("At the roundabout, continue for 50 yd")), "At the roundabout, continue");
});

test("spokenManeuver falls back rather than speaking nothing", () => {
  assert.equal(spokenManeuver(step("for 100 yd")), "Continue");
  assert.equal(spokenManeuver(step("")), "Continue");
});

test("spokenApproach leads with the distance and lower-cases the verb", () => {
  assert.equal(
    spokenApproach(step("Turn right onto Main Street for 168 yd"), 300),
    "In 330 yards, turn right onto Main Street",
  );
});

test("spokenDeparture names the navigation start and first leg", () => {
  assert.equal(
    spokenDeparture(step("Head north on Cathedral Road for 240 yd")),
    "Starting navigation. Head north on Cathedral Road",
  );
  assert.equal(spokenDeparture(null), "Starting navigation.");
});

test("arrival line is a stable human sentence", () => {
  assert.equal(ARRIVAL_SPEECH, "You have arrived at your destination.");
});
