/**
 * Does the BUILT pass worker actually run?
 *
 * WHY THIS IS A SEPARATE TEST. The bundler copies passes-worker.ts into a static
 * export as an uncompiled asset with a .ts extension, which no browser can execute.
 * Every other test in this repo imports the TypeScript source, so they all pass
 * while the deployed worker silently returns nothing. That is exactly the failure
 * this existed to catch: the map renders, the layer toggles on, and the pass layer
 * is empty with nothing in the console to explain it.
 *
 * So this runs the artifact, not the source. It bundles, executes it in a real
 * worker thread against real element sets, and asserts that features come back
 * with plausible elevations. A build step that stops emitting valid JavaScript
 * fails here.
 *
 * Run after npm run build:passes-worker:
 *
 *     node --test scripts/lib/passes-worker-build.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUILT = join(REPO, "public/passes-worker.mjs");
const SOURCE = join(REPO, "src/lib/feeds/passes-worker.ts");

const FIXTURE = readFileSync(
  join(REPO, "scripts/lib/fixtures/celestrak-stations.tle"),
  "utf8",
);

/** The Spaceman teleport, the default station for this layer. */
const STATION = { name: "Spaceman teleport (aql)", lat: 54.139, lon: -4.4951, altM: 60 };

/**
 * Runs the built worker the way a browser does.
 *
 * A module worker uses `self`, which does not exist in a Node worker thread, so it
 * is defined here. This is a shim for the harness only - the shipped file is
 * untouched and remains a plain browser module worker.
 */
function runWorker(request, timeoutMs = 120_000) {
  const code = readFileSync(BUILT, "utf8");
  return new Promise((resolvePromise, rejectPromise) => {
    const worker = new Worker(
      `
      const self = {
        addEventListener: (type, handler) => {
          if (type === "message") self.__onmessage = handler;
        },
        postMessage: (data) => require("node:worker_threads").parentPort.postMessage(data),
        __onmessage: null,
      };
      const port = require("node:worker_threads").parentPort;
      port.on("message", (data) => self.__onmessage?.({ data }));
      ${code}
      `,
      { eval: true },
    );

    const timer = setTimeout(() => {
      worker.terminate();
      rejectPromise(new Error(`worker did not reply within ${timeoutMs}ms`));
    }, timeoutMs);

    worker.on("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      resolvePromise(msg);
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      worker.terminate();
      rejectPromise(err);
    });

    worker.postMessage(request);
  });
}

test("the built worker exists and is JavaScript, not TypeScript", () => {
  assert.ok(existsSync(BUILT), "public/passes-worker.mjs is missing - run npm run build:passes-worker");

  const code = readFileSync(BUILT, "utf8");
  // The specific defect this guards: the export shipped raw .ts source.
  assert.doesNotMatch(
    code,
    /^\s*(import|export)\s+.*\bfrom\b/m,
    "the worker still contains uncompiled import/export statements",
  );
  assert.doesNotMatch(code, /:\s*(string|number|boolean)\b/, "type annotations survived");
  assert.doesNotMatch(code, /\binterface\s+\w+\s*\{/, "a type declaration survived");

  // Inlined, or the browser cannot resolve it: there is no node_modules on a
  // static host.
  assert.doesNotMatch(code, /from\s*["'][^"']*node_modules/, "a bare node_modules import survived");
  assert.ok(statSync(BUILT).size > 20_000, "bundle is too small to contain the propagator");
});

test("the built worker is newer than its source", () => {
  // A stale artifact passes every other test here while the deployed site runs
  // yesterday's code, which is a genuinely confusing failure mode.
  assert.ok(
    statSync(BUILT).mtimeMs >= statSync(SOURCE).mtimeMs,
    "public/passes-worker.mjs is older than passes-worker.ts - rebuild it",
  );
});

test("the built worker returns features with plausible passes", async () => {
  const reply = await runWorker({
    id: 1,
    tles: FIXTURE,
    station: STATION,
    windowHours: 48,
    stepS: 30,
    minElevDeg: 5,
  });

  assert.ok(reply.ok, `worker reported failure: ${reply.error}`);
  const fc = reply.result;

  assert.equal(fc.type, "FeatureCollection");
  assert.ok(
    Array.isArray(fc.features) && fc.features.length > 0,
    "no features returned - this is the bug that makes the layer look empty",
  );

  for (const f of fc.features) {
    const p = f.properties;
    assert.ok(p.name, "a feature has no name");
    assert.match(String(p.noradId), /^\d+$/, `bad norad id: ${p.noradId}`);
    assert.ok(p.passCount > 0, `${p.name} has no passes`);
    assert.ok(
      p.bestElevationDeg >= 5 && p.bestElevationDeg <= 90,
      `${p.name} has a nonsensical elevation: ${p.bestElevationDeg}`,
    );
    // Flat by construction: FeaturePopup stringifies everything it is given, so an
    // array of objects here renders as literal "[object Object]".
    assert.equal(typeof p.passes, "string", `${p.name}: passes must be a flat string`);
    assert.ok(p.nextPass, `${p.name} has no nextPass`);
    assert.ok(f.geometry.coordinates.every(Number.isFinite), `${p.name} has bad coordinates`);
  }
});

test("the built worker reports a bad element set rather than failing the batch", async () => {
  // Resilience: upstream corruption must cost one satellite, not the whole layer.
  const reply = await runWorker({
    id: 2,
    tles: `${FIXTURE}GARBAGE\r\nnot a tle\r\nstill not a tle\r\n`,
    station: STATION,
    windowHours: 48,
    stepS: 30,
    minElevDeg: 5,
  });

  assert.ok(reply.ok, "a garbage line should not fail the whole computation");
  assert.ok(reply.result.features.length > 0, "the good records were lost");
});

test("the built worker rejects a wholly corrupt payload without hanging", async () => {
  const reply = await runWorker({
    id: 3,
    tles: "MYSTERY\r\nnot a tle at all\r\n",
    station: STATION,
    windowHours: 48,
    stepS: 30,
    minElevDeg: 5,
  });

  // Either an empty collection or an explicit failure is acceptable; hanging or
  // emitting nonsense is not.
  if (reply.ok) {
    assert.equal(reply.result.features.length, 0);
  } else {
    assert.ok(reply.error, "a failure reply must say why");
  }
});