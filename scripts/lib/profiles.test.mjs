/**
 * Unit tests for routing profiles (src/lib/navigation/profiles.ts).
 *
 * Covers access rules, one-way direction enforcement, cycling profile,
 * maxspeed parsing and capping, and profile speed lookups.
 * Pure math, runs under `node --test`.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  edgeSpeed,
  edgeTimeS,
  maxSpeedKmh,
  parseMaxspeedKmh,
  directionAllowed,
  PROFILES,
  ROUTE_MODES,
} from "../../src/lib/navigation/profiles.ts";

const DRIVING = PROFILES.driving;
const WALKING = PROFILES.walking;
const CYCLING = PROFILES.cycling;

test("parseMaxspeedKmh handles km/h values", () => {
  assert.equal(parseMaxspeedKmh("50"), 50);
  assert.equal(parseMaxspeedKmh("30 km/h"), 30);
  assert.equal(parseMaxspeedKmh("30 kmh"), 30);
  assert.equal(parseMaxspeedKmh("30 kph"), 30);
});

test("parseMaxspeedKmh handles mph values and converts", () => {
  assert.equal(parseMaxspeedKmh("30 mph"), 48.28032);
  assert.equal(parseMaxspeedKmh("20 mph"), 32.18688);
  assert.equal(parseMaxspeedKmh("60 mph"), 96.56064);
});

test("parseMaxspeedKmh returns null for non-numeric values", () => {
  assert.equal(parseMaxspeedKmh("national"), null);
  assert.equal(parseMaxspeedKmh("NSL"), null);
  assert.equal(parseMaxspeedKmh("signals"), null);
  assert.equal(parseMaxspeedKmh("walk"), null);
  assert.equal(parseMaxspeedKmh(null), null);
  assert.equal(parseMaxspeedKmh(undefined), null);
  assert.equal(parseMaxspeedKmh(""), null);
});

test("directionAllowed respects oneway forward/reverse", () => {
  const twoWay = { name: null, oneway: 0, access: null, motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: null };
  const oneWayFwd = { ...twoWay, oneway: 1 };
  const oneWayRev = { ...twoWay, oneway: -1 };
  const roundabout = { ...twoWay, oneway: 1 }; // junction=roundabout gives oneway=1 in parser

  assert.equal(directionAllowed(twoWay, true), true);
  assert.equal(directionAllowed(twoWay, false), true);
  assert.equal(directionAllowed(oneWayFwd, true), true);
  assert.equal(directionAllowed(oneWayFwd, false), false);
  assert.equal(directionAllowed(oneWayRev, true), false);
  assert.equal(directionAllowed(oneWayRev, false), true);
});

test("driving refuses footway/path/cycleway/pedestrian", () => {
  assert.equal(edgeSpeed(DRIVING, "footway", null), null);
  assert.equal(edgeSpeed(DRIVING, "path", null), null);
  assert.equal(edgeSpeed(DRIVING, "cycleway", null), null);
  assert.equal(edgeSpeed(DRIVING, "pedestrian", null), null);
  assert.equal(edgeSpeed(DRIVING, "steps", null), null);
  assert.equal(edgeSpeed(DRIVING, "bridleway", null), null);
  assert.equal(edgeSpeed(DRIVING, "proposed", null), null);
  assert.equal(edgeSpeed(DRIVING, "construction", null), null);
  assert.equal(edgeSpeed(DRIVING, "ferry", null), null);
});

test("driving respects access=no and access=private", () => {
  const deny = { name: null, oneway: 0, access: "no", motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: null };
  const privateRoad = { name: null, oneway: 0, access: "private", motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: null };
  assert.equal(edgeSpeed(DRIVING, "residential", deny), null);
  assert.equal(edgeSpeed(DRIVING, "residential", privateRoad), null);
});

test("driving respects motor_vehicle=no overrides class default", () => {
  const deny = { name: null, oneway: 0, access: null, motorVehicle: "no", motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: null };
  assert.equal(edgeSpeed(DRIVING, "residential", deny), null);
});

test("driving respects maxspeed cap on residential", () => {
  const capped = { name: null, oneway: 0, access: null, motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: "30 mph" };
  // residential default is 40 km/h; 30 mph = 48.28 km/h; cap is min(40, 48.28) = 40
  // Actually 30 mph is HIGHER than 40 km/h default, so no cap
  assert.equal(edgeSpeed(DRIVING, "residential", capped), 40);

  const lower = { ...capped, maxspeed: "20 mph" }; // 32.18 km/h
  assert.equal(edgeSpeed(DRIVING, "residential", lower), 32.18688);
});

test("walking allows footway/path/cycleway/pedestrian", () => {
  assert.equal(edgeSpeed(WALKING, "footway", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "path", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "cycleway", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "pedestrian", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "bridleway", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "service", null), 4.8);
  assert.equal(edgeSpeed(WALKING, "residential", null), 4.8);
});

test("walking refuses motorway/trunk/raceway/ferry", () => {
  assert.equal(edgeSpeed(WALKING, "motorway", null), null);
  assert.equal(edgeSpeed(WALKING, "trunk", null), null);
  assert.equal(edgeSpeed(WALKING, "raceway", null), null);
  assert.equal(edgeSpeed(WALKING, "ferry", null), null);
});

test("walking ignores one-way restriction", () => {
  const oneWay = { name: null, oneway: 1, access: null, motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: null, service: null, maxspeed: null };
  // edgeTimeS with forward=false should still return time for walking
  const time = edgeTimeS(WALKING, 100, "residential", oneWay, false);
  assert.ok(time !== null && time > 0);
});

test("cycling allows cycleway and track at 18 km/h", () => {
  assert.equal(edgeSpeed(CYCLING, "cycleway", null), 18);
  assert.equal(edgeSpeed(CYCLING, "track", null), 12);
  assert.equal(edgeSpeed(CYCLING, "bridleway", null), 12);
});

test("cycling allows footway/path only when bicycle=yes/permissive/designated/dismount", () => {
  const permissive = { name: null, oneway: 0, access: null, motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: "yes", service: null, maxspeed: null };
  const dismount = { ...permissive, bicycle: "dismount" };
  const noTag = { ...permissive, bicycle: null };
  const forbid = { ...permissive, bicycle: "no" };

  // footway class speed is 8 km/h even with bicycle=yes (cautious cycling)
  assert.equal(edgeSpeed(CYCLING, "footway", permissive), 8);
  assert.equal(edgeSpeed(CYCLING, "footway", dismount), 5); // DISMOUNT_KMH = 5
  assert.equal(edgeSpeed(CYCLING, "footway", noTag), null);
  assert.equal(edgeSpeed(CYCLING, "footway", forbid), null);
});

test("cycling respects maxspeed cap", () => {
  const capped = { name: null, oneway: 0, access: null, motorVehicle: null, motorcar: null, vehicle: null, foot: null, bicycle: "yes", service: null, maxspeed: "15 mph" }; // 24.14 km/h
  assert.equal(edgeSpeed(CYCLING, "residential", capped), 18); // residential default 18, capped by 15 mph -> 18? Wait 15 mph = 24.14 > 18, so no cap
  // Actually residential cycling is 18, so 15 mph (24.14) is higher - no cap
  const lower = { ...capped, maxspeed: "8 mph" }; // 12.87 km/h
  assert.equal(edgeSpeed(CYCLING, "residential", lower), 12.874752);
});

test("cycling refuses motorway/raceway/steps/ferry", () => {
  assert.equal(edgeSpeed(CYCLING, "motorway", null), null);
  assert.equal(edgeSpeed(CYCLING, "raceway", null), null);
  assert.equal(edgeSpeed(CYCLING, "steps", null), null);
  assert.equal(edgeSpeed(CYCLING, "ferry", null), null);
});

test("maxSpeedKmh returns highest speed in each profile", () => {
  assert.equal(maxSpeedKmh(DRIVING), 100);
  assert.equal(maxSpeedKmh(WALKING), 4.8);
  assert.equal(maxSpeedKmh(CYCLING), 18);
});

test("ROUTE_MODES includes all three modes in correct order", () => {
  assert.deepEqual(ROUTE_MODES, ["driving", "cycling", "walking"]);
});