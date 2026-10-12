import { test } from "node:test";
import assert from "node:assert/strict";
import { easeInOutCubic, lerpPoint, lerpAngle, isPlausibleTransition } from "../../src/lib/navigation/motion.ts";

test("easeInOutCubic clamps and hits the endpoints", () => {
  assert.equal(easeInOutCubic(-1), 0);
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(2), 1);
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9);
});

test("lerpPoint interpolates and clamps", () => {
  const a = { lon: -4.5, lat: 54.1 };
  const b = { lon: -4.4, lat: 54.2 };
  assert.deepEqual(lerpPoint(a, b, 0), a);
  assert.deepEqual(lerpPoint(a, b, 1), b);
  const mid = lerpPoint(a, b, 0.5);
  assert.ok(Math.abs(mid.lon - -4.45) < 1e-9 && Math.abs(mid.lat - 54.15) < 1e-9);
  assert.deepEqual(lerpPoint(a, b, -3), a);
  assert.deepEqual(lerpPoint(a, b, 9), b);
});

test("lerpAngle turns along the shorter arc across north", () => {
  // 350 -> 10 is +20 through north, not -340 the long way.
  const v = lerpAngle(350, 10, 0.5);
  assert.ok(Math.abs(v - 0) < 1e-9 || Math.abs(v - 360) < 1e-9, `got ${v}`);
});

test("lerpAngle snaps when there is no previous bearing", () => {
  assert.equal(lerpAngle(null, 123, 0.5), 123);
  assert.equal(lerpAngle(45, null, 0.5), 45);
  assert.equal(lerpAngle(null, null, 0.5), null);
});

test("isPlausibleTransition rejects impossible jumps and stale fixes", () => {
  const a = { lon: -4.5, lat: 54.15 };
  const near = { lon: -4.4999, lat: 54.15 };
  const far = { lon: -4.4, lat: 54.15 };
  assert.ok(isPlausibleTransition(a, near, 1), "~7 m/s is plausible");
  assert.equal(isPlausibleTransition(a, far, 1), false, "~6.5 km in 1 s is not");
  assert.equal(isPlausibleTransition(a, near, 0), false, "zero elapsed time refused");
  assert.equal(isPlausibleTransition(a, near, -1), false, "negative elapsed time refused");
  // A legitimate long gap is fine: ~6.5 km over 120 s ~ 54 m/s.
  assert.ok(isPlausibleTransition(a, far, 120), "highway speed over a long gap");
});
