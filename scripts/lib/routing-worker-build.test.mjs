/**
 * Does the BUILT routing worker actually run?
 *
 * Same risk as the pass worker (see passes-worker-build.test.mjs): every other
 * test imports the TypeScript source, so they can all pass while the deployed
 * public/routing-worker.mjs is stale, uncompiled, or broken. This executes the
 * artifact - the exact file public/ - inside a real worker thread against real
 * roads + footpaths data and asserts it comes back with a route.
 *
 * The routing worker fetches /data/roads.geojson and /data/footpaths.geojson
 * itself, so the harness shims `fetch` and provides the committed data via
 * workerData (no multi-MB strings marshalled through an eval'd file).
 *
 * Run after npm run build:routing-worker:
 *
 *     node --test scripts/lib/routing-worker-build.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUILT = join(REPO, "public/routing-worker.mjs");
const SOURCE = join(REPO, "src/lib/navigation/routing-worker.ts");
const GRAPH_SOURCES = [
  "src/lib/navigation/graph.ts",
  "src/lib/navigation/profiles.ts",
].map((p) => join(REPO, p));

const ROADS = readFileSync(join(REPO, "public/data/roads.geojson"), "utf8");
const FOOTPATHS = readFileSync(join(REPO, "public/data/footpaths.geojson"), "utf8");

/** Douglas seafront (start) and Ramsey (destination): a real, drivable trip. */
const TRIP = {
  start: { lon: -4.4836, lat: 54.1557 },
  dest: { lon: -4.3851, lat: 54.3226 },
};

/**
 * Runs the BUILT worker the way a browser would: module worker semantics
 * (`self.addEventListener`) with fetch() pointed at the committed roads data.
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
      self.fetch = async (url) => {
        const want = String(url);
        const body = want.includes("footpaths")
          ? require("node:worker_threads").workerData.footpaths
          : require("node:worker_threads").workerData.roads;
        return { ok: true, status: 200, json: async () => body };
      };
      // The worker calls bare fetch(), which in a browser worker is self.fetch.
      globalThis.fetch = self.fetch;
      const port = require("node:worker_threads").parentPort;
      port.on("message", (data) => self.__onmessage?.({ data }));
      ${code}
      `,
      { eval: true, workerData: { roads: JSON.parse(ROADS), footpaths: JSON.parse(FOOTPATHS) } },
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
  assert.ok(existsSync(BUILT), "public/routing-worker.mjs is missing - run npm run build:routing-worker");

  const code = readFileSync(BUILT, "utf8");
  // The defect this guards: shipping raw .ts source the browser cannot run.
  assert.doesNotMatch(
    code,
    /^\s*(import|export)\s+.*\b\w+\s+from\b/m,
    "the worker still contains uncompiled import/export statements",
  );
  assert.doesNotMatch(code, /\binterface\s+\w+\s*\{/, "a type declaration survived");
  // Inlined graph, or the browser cannot resolve it on a static host.
  assert.doesNotMatch(code, /from\s*["'][^"']*node_modules/, "a bare node_modules import survived");
  assert.ok(statSync(BUILT).size > 3000, "bundle is too small to contain the routing code");
});

test("the built worker is newer than its sources", () => {
  const built = statSync(BUILT).mtimeMs;
  for (const src of [SOURCE, ...GRAPH_SOURCES]) {
    assert.ok(
      built >= statSync(src).mtimeMs,
      `public/routing-worker.mjs is older than ${src} - rebuild it`,
    );
  }
});

test("the built worker routes Douglas to Ramsey for both profiles", async () => {
  const reply = await runWorker({
    id: 1,
    start: TRIP.start,
    dest: TRIP.dest,
    modes: ["driving", "walking"],
  });

  assert.ok(reply.ok, `worker reported failure: ${reply.error}`);
  assert.ok(reply.result, "no result object");
  assert.ok(reply.result.driving, "no driving route - this is the silent-empty bug");
  assert.ok(reply.result.walking, "no walking route");

  for (const mode of ["driving", "walking"]) {
    const leg = reply.result[mode];
    assert.ok(leg.distanceM > 15_000, `${mode} distance ${leg.distanceM} m implausibly short`);
    assert.ok(leg.distanceM < 60_000, `${mode} distance ${leg.distanceM} m implausibly long`);
    assert.ok(leg.durationS > 0, `${mode} duration must be positive`);
    assert.ok(
      Array.isArray(leg.coordinates) && leg.coordinates.length >= 4,
      `${mode} route has no geometry`,
    );
    for (const [lon, lat] of leg.coordinates) {
      assert.ok(Number.isFinite(lon) && Number.isFinite(lat), `${mode} route has a bad vertex`);
    }
    const first = leg.coordinates[0];
    const last = leg.coordinates[leg.coordinates.length - 1];
    assert.ok(Math.abs(first[0] - TRIP.start.lon) < 1e-3, `${mode} must start at the drop point`);
    assert.ok(Math.abs(last[0] - TRIP.dest.lon) < 1e-3, `${mode} must end at the pin`);
  }
});

test("the built worker reports corrupted roads data without hanging", async () => {
  // The whole-point: a broken upstream must surface as a clear error, not a
  // spinner that never returns.
  const badCode = readFileSync(BUILT, "utf8");
  const reply = await new Promise((resolvePromise) => {
    const worker = new Worker(
      `
      const self = {
        addEventListener: (type, handler) => { if (type === "message") self.__onmessage = handler; },
        postMessage: (data) => require("node:worker_threads").parentPort.postMessage(data),
        __onmessage: null,
      };
      // 400 with unparseable JSON - routes data isn't what we promised.
      self.fetch = async () => ({ ok: false, status: 400, json: async () => { throw new Error("boom"); } });
      globalThis.fetch = self.fetch;
      const port = require("node:worker_threads").parentPort;
      port.on("message", (data) => self.__onmessage?.({ data }));
      ${badCode}
      `,
      { eval: true },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      resolvePromise({ timedOut: true });
    }, 15_000);
    worker.on("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      resolvePromise(msg);
    });
    worker.on("error", () => {
      clearTimeout(timer);
      worker.terminate();
      resolvePromise({ workerCrashed: true });
    });
    worker.postMessage({ id: 2, start: TRIP.start, dest: TRIP.dest, modes: ["driving"] });
  });

  assert.equal(reply.timedOut, undefined, "worker must reply, not hang");
  assert.equal(reply.workerCrashed, undefined, "worker must catch fetch errors");
  assert.equal(reply.ok, false);
  assert.ok(typeof reply.error === "string" && reply.error.length > 0, "failure must say why");
});