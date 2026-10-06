/**
 * Tests for the shared ingest plumbing in scripts/lib/fetch.mjs.
 *
 * Run with: node --test scripts/lib/fetch.test.mjs
 *
 * Three of these encode regressions that shipped to production data:
 *
 *   - simplifyGeometry treated a MultiPolygon's polygon list as a ring list,
 *     so a MultiPolygon whose members were ordinary single-ring polygons came
 *     back null and the whole feature silently vanished.
 *   - get()'s "no point retrying a 4xx" path threw inside the loop's own try,
 *     so the catch swallowed it and a 4xx was re-requested three times anyway.
 *   - writeJSON wrote straight to the target, so a process killed mid-write
 *     left a truncated layer that still passed next build's manifest check.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { get, writeJSON, simplifyGeometry } from "./fetch.mjs";

function overpassServer(script) {
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    script(req, res, requests);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/`, requests: () => requests });
  }));
}

// --- simplifyGeometry -----------------------------------------------------

test("simplifyGeometry keeps single-ring polygons inside a MultiPolygon", async () => {
  // The regression: one-ring polygon members were filtered out by the `length
  // >= 4` ring test and the whole feature became null.
  const mp = {
    type: "MultiPolygon",
    coordinates: [[[[-4.5, 54.1], [-4.5, 54.2], [-4.4, 54.2], [-4.4, 54.1], [-4.5, 54.1]]]],
  };
  const out = simplifyGeometry(mp, 0.00001);
  assert.ok(out, "MultiPolygon must survive simplification");
  assert.equal(out.type, "MultiPolygon");
  assert.equal(out.coordinates.length, 1);
  assert.equal(out.coordinates[0].length, 1);
  assert.ok(out.coordinates[0][0].length >= 4);
});

test("simplifyGeometry keeps all rings of a compound MultiPolygon member", async () => {
  const mp = {
    type: "MultiPolygon",
    coordinates: [
      [
        [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
        [[2, 2], [2, 3], [3, 2], [2, 2]],
      ],
    ],
  };
  const out = simplifyGeometry(mp, 0.00001);
  assert.ok(out);
  assert.equal(out.coordinates[0].length, 2);
});

test("simplifyGeometry drops members that collapse below 4 points", async () => {
  // tol 0.5 collapses the 3-point ring (a spike with no area) while leaving
  // the 5-point square intact, so exactly one member survives.
  const mp = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [0, 1], [0, 0]]],
      [[[4, 4], [4, 5], [5, 5], [5, 4], [4, 4]]],
    ],
  };
  const out = simplifyGeometry(mp, 0.5);
  assert.ok(out);
  assert.equal(out.coordinates.length, 1, "only the valid ring survives");
});

test("simplifyGeometry returns null when no member of a MultiPolygon survives", async () => {
  const mp = { type: "MultiPolygon", coordinates: [[[[0, 0], [0, 1], [0, 0]]]] };
  assert.equal(simplifyGeometry(mp, 1e9), null);
});

test("simplifyGeometry still collapses degenerate single Polygons", async () => {
  const p = { type: "Polygon", coordinates: [[[[0, 0], [0, 1], [0, 0]]]] };
  assert.equal(simplifyGeometry(p, 1e9), null);
});

// --- get() retry policy ---------------------------------------------------

test("get() fails fast on a permanent 4xx (no retries)", async () => {
  const { server, url, requests } = await overpassServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("nope");
  });
  try {
    await assert.rejects(get(url, { retries: 3, backoffBaseMs: 1 }), /HTTP 404/);
    assert.equal(requests(), 1, "a 4xx must not be re-requested");
  } finally {
    server.close();
  }
});

test("get() retries 5xx until it succeeds", async () => {
  const { server, url, requests } = await overpassServer((_req, res, n) => {
    if (n < 3) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("busy");
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }
  });
  try {
    const res = await get(url, { retries: 3, backoffBaseMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(requests(), 3);
  } finally {
    server.close();
  }
});

test("get() retries a 429 (a polite refusal)", async () => {
  const { server, url, requests } = await overpassServer((_req, res, n) => {
    if (n === 1) {
      res.writeHead(429, { "content-type": "text/plain" });
      res.end("slow down");
    } else {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    }
  });
  try {
    const res = await get(url, { retries: 1, backoffBaseMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(requests(), 2);
  } finally {
    server.close();
  }
});

test("get() blames the host on a 5xx that never clears", async () => {
  const { server, url, requests } = await overpassServer((_req, res) => {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("boom");
  });
  try {
    await assert.rejects(get(url, { retries: 2, backoffBaseMs: 1 }), /HTTP 500/);
    assert.equal(requests(), 3);
  } finally {
    server.close();
  }
});

// --- writeJSON ------------------------------------------------------------

test("writeJSON writes content and leaves no temp sibling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmannin-writejson-"));
  const target = path.join(dir, "out.geojson");
  writeJSON(target, { a: [1, 2, { b: 3 }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { a: [1, 2, { b: 3 }] });
  assert.deepEqual(fs.readdirSync(dir), ["out.geojson"], "temp file must be renamed away");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeJSON overwrites and honours trailing newline", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openmannin-writejson-"));
  const target = path.join(dir, "out.json");
  writeJSON(target, { v: 1 });
  writeJSON(target, { v: 2 }, { trailingNewline: true });
  assert.ok(fs.readFileSync(target, "utf8").endsWith("\n"));
  assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { v: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});