import { test } from "node:test";
import { strict as assert } from "node:assert";

import {
  surfaceMode,
  currentStep,
  nextStep,
  hasFix,
  etaMinutes,
  bannerFor,
  dockFor,
  stepsTeaser,
} from "../../src/lib/navigation/hud.ts";

function state(overrides = {}) {
  return {
    locationStatus: "active",
    locationError: null,
    userLocation: { lon: -4.48, lat: 54.15, timestamp: 1 },
    destination: { lon: -4.69, lat: 54.22, title: "Peel", detail: "" },
    activeMode: "driving",
    routeStatus: "ready",
    routeError: null,
    routes: { driving: { distanceM: 1000, durationS: 300 } },
    steps: [
      { instruction: "head to the A1", distanceM: 400, bearing: 270, maneuver: "depart", side: null },
      { instruction: "turn left onto Main Road", distanceM: 600, bearing: 270, maneuver: "left", side: "left" },
    ],
    speedMph: 25,
    speedLimitKmh: 48,
    stepIndex: 0,
    nextStepM: 180,
    recenterPending: false,
    followMode: "follow",
    voiceMuted: false,
    offRoute: false,
    navigating: false,
    progressM: 0,
    remainingM: 900,
    ...overrides,
  };
}

test("surfaceMode selects none/preview/guide/arrived", () => {
  assert.equal(surfaceMode(null), "none");
  assert.equal(surfaceMode(state({ destination: null })), "none");
  assert.equal(surfaceMode(state()), "preview");
  assert.equal(surfaceMode(state({ navigating: true })), "guide");
  assert.equal(surfaceMode(state({ routeStatus: "arrived" })), "arrived");
});

test("currentStep and nextStep clamp and support empty routes", () => {
  assert.equal(currentStep(null), null);
  assert.equal(currentStep(state({ steps: [] })), null);
  assert.equal(currentStep(state({ stepIndex: 99 }))?.instruction, "turn left onto Main Road");
  assert.equal(currentStep(state({ stepIndex: -1 }))?.instruction, "head to the A1");
  assert.deepEqual(nextStep(state({})).instruction, "turn left onto Main Road");
  assert.equal(nextStep(state({ stepIndex: 1 })), null);
});

test("hasFix checks active location", () => {
  assert.equal(hasFix(state()), true);
  assert.equal(hasFix(state({ locationStatus: "idle" })), false);
  assert.equal(hasFix(state({ userLocation: null })), false);
});

test("etaMinutes uses live speed or route average", () => {
  const live = etaMinutes(state({ speedMph: 10, remainingM: 268.224 }));
  assert.equal(live, 1);
  const fallback = etaMinutes(state({ speedMph: 1, remainingM: 200 }));
  assert.equal(fallback, 1);
  assert.equal(etaMinutes(state({ speedMph: 1, routes: {} })), 0);
});

test("etaMinutes returns zero when no route remains", () => {
  assert.equal(etaMinutes(state({ remainingM: 0 })), 0);
});

test("bannerFor preview is invisible with destination text", () => {
  const banner = bannerFor(state(), false);
  assert.ok(banner);
  assert.equal(banner.visible, false);
  assert.equal(banner.instruction, "Peel");
  assert.equal(banner.primary, "Start there");
});

test("bannerFor shows route warnings, loading and arrival", () => {
  assert.equal(bannerFor(state({ routeStatus: "no-route", routeError: "none found" }), true)?.tone, "warn");
  assert.equal(bannerFor(state({ routeStatus: "error", routeError: "broken" }), true)?.tone, "danger");
  assert.equal(bannerFor(state({ routeStatus: "loading" }), true)?.tone, "neutral");
  assert.equal(bannerFor(state({ routeStatus: "arrived" }), true)?.tone, "ok");
});

test("bannerFor off-route and maneuvers", () => {
  const offRoute = bannerFor(state({ offRoute: true, routeStatus: "ready" }), true);
  assert.equal(offRoute?.tone, "warn");
  assert.equal(offRoute?.primary, "Off route—recalc when convenient");
  const overLimit = bannerFor(state({ speedMph: 35, speedLimitKmh: 48, navigating: true }), true);
  assert.equal(overLimit?.overSpeed, true);
});

test("bannerFor hides speed limits outside driving and preview", () => {
  const walking = bannerFor(state({ activeMode: "walking", navigating: true }), true);
  assert.equal(walking?.speedLimitMph, null);
});

test("dockFor formats remaining distance and ETA", () => {
  const dock = dockFor(state({ remainingM: 2682, speedMph: 10 }));
  assert.equal(dock?.etaLabel, "10 min");
  assert.equal(dock?.speedLabel, "10 mph");
  assert.equal(dock?.offRoute, false);
});

test("stepsTeaser respects open state", () => {
  assert.deepEqual(stepsTeaser(state(), false), []);
  assert.equal(stepsTeaser(state(), true).length, 2);
  assert.equal(stepsTeaser(null, true).length, 0);
});
