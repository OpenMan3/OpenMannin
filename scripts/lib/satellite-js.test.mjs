/**
 * Tests for the browser-safe satellite.js entry points.
 *
 * WHY THESE EXIST. satellite.js's default export re-exports its WASM build,
 * which imports `node:module` and `node:worker_threads`. The pass layer used to
 * run on the Node server where that was fine; the moment it moved into the
 * browser, the whole app stopped compiling:
 *
 *     Module build failed: UnhandledSchemeError: Reading from "node:module"
 *
 * src/lib/feeds/satellite-js.ts works around that by importing the pure-JS
 * submodules directly. That workaround is invisible in a diff of any file except
 * its own, and it fails in the most expensive way available - the build hangs or
 * errors on a dependency upgrade, with an error message that points into
 * node_modules rather than at anything this repo did.
 *
 * So both of its properties are asserted here: that the import graph stays free
 * of `node:` specifiers, and that the arithmetic still agrees with the WASM build
 * the previous server-side route used. The second is the important one. A
 * bundler-compatible rewrite that quietly changed the maths would produce
 * plausible-looking satellite positions that are simply wrong, and nothing else
 * in this repo would catch it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SATELLITE_JS = join(REPO, "node_modules/satellite.js");

/**
 * Real captured element sets, in the real wire format.
 *
 * See fixtures/README.md for why these are captured rather than written by hand.
 */
const FIXTURE = readFileSync(
  join(REPO, "scripts/lib/fixtures/celestrak-stations.tle"),
  "utf8",
);

/** The element sets in FIXTURE, as `{ name, line1, line2 }`. */
function elementSets() {
  const lines = FIXTURE.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("1 ")) continue;
    let name = `NORAD ${lines[i].slice(2, 7).trim()}`;
    for (let k = i - 1; k >= 0; k--) {
      const candidate = lines[k].trim();
      if (!candidate) continue;
      if (candidate.startsWith("1 ") || candidate.startsWith("2 ")) break;
      name = candidate;
      break;
    }
    out.push({ name, line1: lines[i].trim(), line2: lines[i + 1].trim() });
    i++;
  }
  return out;
}

/**
 * Source text with comments removed.
 *
 * The guard below matches on `from "..."`, which appears verbatim in the prose of
 * this repo's own doc comments as a worked example of the import that must NOT be
 * used. Scanning raw text therefore fails for the right-looking reason at the
 * wrong place.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Walks the relative import graph from a file, following `.js` specifiers the way
 * a bundler would, and collects any `node:` built-ins reached along the way.
 */
function walkImports(from, seen = new Set(), nodeSpecs = []) {
  const abs = resolve(from);
  if (seen.has(abs)) return { seen, nodeSpecs };
  seen.add(abs);

  let source;
  try {
    source = code(readFileSync(abs, "utf8"));
  } catch {
    return { seen, nodeSpecs }; // types-only, or unresolvable from here
  }

  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.startsWith("node:")) {
      nodeSpecs.push(`${abs}: ${spec}`);
      continue;
    }
    if (!spec.startsWith(".")) continue;
    walkImports(join(dirname(abs), spec), seen, nodeSpecs);
  }
  return { seen, nodeSpecs };
}

test("the pass layer does not import satellite.js by its package name", () => {
  // The bare specifier is the whole problem: dist/index.js re-exports the WASM
  // build. If someone tidies the shim back to `from "satellite.js"`, this fails
  // here rather than taking the build down.
  const shim = code(
    readFileSync(join(REPO, "src/lib/feeds/satellite-js.ts"), "utf8"),
  );
  const bare = [...shim.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((spec) => spec === "satellite.js");
  assert.deepEqual(
    bare,
    [],
    "src/lib/feeds/satellite-js.ts must not import the package entry point",
  );
});

test("nothing reachable from the pass layer's satellite import needs Node built-ins", async () => {
  const { seen, nodeSpecs } = walkImports(
    join(REPO, "src/lib/feeds/satellite-js.ts"),
  );

  assert.ok(seen.size > 0, "the walk reached no modules, which means it is broken");
  assert.ok(
    seen.size < 40,
    `expected a small pure-JS graph, walked ${seen.size} modules - the shim may be reaching the WASM build`,
  );
  assert.deepEqual(nodeSpecs, [], "a node: built-in is reachable from the browser bundle");

  // The shim's exports must actually be the ones the worker imports, or the
  // worker fails to resolve at build time and the pass layer silently vanishes.
  const exports = [...code(
    readFileSync(join(REPO, "src/lib/feeds/satellite-js.ts"), "utf8"),
  ).matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.trim()));

  const worker = code(
    readFileSync(join(REPO, "src/lib/feeds/passes-worker.ts"), "utf8"),
  );
  const imported = /import\s*\{([^}]*)\}\s*from\s*["']\.\/satellite-js["']/.exec(worker)?.[1] ?? "";
  const wanted = imported.split(",").map((s) => s.trim()).filter(Boolean);

  assert.ok(wanted.length >= 8, `expected the worker's import list to be read, got ${wanted.length}`);
  for (const name of wanted) {
    assert.ok(exports.includes(name), `satellite-js.ts does not re-export ${name}`);
  }
});

test("the pure-JS path is present and needs no WASM loader", () => {
  // Guards the specific files the shim names. If a satellite.js upgrade relocates
  // them, this names the breakage instead of leaving a build failure to explain.
  for (const file of [
    "dist/propagation.js",
    "dist/io.js",
    "dist/transforms.js",
    "dist/ext.js",
  ]) {
    const path = join(SATELLITE_JS, file);
    assert.ok(statSync(path).isFile(), `satellite.js no longer ships ${file}`);
    assert.match(readFileSync(path, "utf8"), /export/, `${file} exports nothing`);
  }
});

test("pure-JS propagation agrees exactly with the WASM build it replaces", async () => {
  // The reference is satellite.js's own WASM build: the code path the previous
  // server-side route used to produce these passes. Bit-identical output is the
  // expected result, since this is the same algorithm from the same package, and
  // any drift at all would mean the rewrite changed the physics.
  const wasm = await import("satellite.js");
  const pureJs = await import(join(SATELLITE_JS, "dist/propagation.js"));
  const io = await import(join(SATELLITE_JS, "dist/io.js"));

  let compared = 0;

  for (const { line1, line2 } of elementSets()) {
    const fromWasm = wasm.twoline2satrec(line1, line2);
    const fromJs = io.twoline2satrec(line1, line2);
    assert.ok(fromJs, `element set failed to parse: ${line1}`);

    for (let hours = 0; hours <= 24; hours += 1) {
      const when = new Date(Date.now() + hours * 3_600_000);
      const a = wasm.propagate(fromWasm, when);
      const b = pureJs.propagate(fromJs, when);

      assert.ok(a?.position && b?.position, `propagation returned null at +${hours}h`);

      assert.equal(b.position.x, a.position.x, `position x at +${hours}h`);
      assert.equal(b.position.y, a.position.y, `position y at +${hours}h`);
      assert.equal(b.position.z, a.position.z, `position z at +${hours}h`);
      assert.equal(b.velocity.x, a.velocity.x, `velocity x at +${hours}h`);
      assert.equal(b.velocity.y, a.velocity.y, `velocity y at +${hours}h`);
      assert.equal(b.velocity.z, a.velocity.z, `velocity z at +${hours}h}`);
      compared++;
    }
  }

  assert.equal(compared, 4 * 25, "expected 4 element sets x 25 hourly samples");
});

test("propagated positions are physically plausible", async () => {
  // An exact match with a wrong reference is still wrong. These bound what a
  // low-Earth-orbit element set must satisfy, independently of satellite.js.
  const { propagate } = await import(join(SATELLITE_JS, "dist/propagation.js"));
  const { twoline2satrec } = await import(join(SATELLITE_JS, "dist/io.js"));

  // Earth radius, km.
  const EARTH_R = 6378.135;
  let sampled = 0;

  for (const { name, line1, line2 } of elementSets()) {
    const sat = twoline2satrec(line1, line2);
    assert.ok(sat, `${name} failed to parse`);

    // The perigee/apogee bounds the element set itself implies. Every propagated
    // radius must sit inside them, allowing a small margin for the drag term
    // moving the actual orbit within the sampled span.
    // altp and alta are altitudes in Earth radii, so the radius bounds add one.
    const perigeeKm = (1 + sat.altp) * EARTH_R;
    const apogeeKm = (1 + sat.alta) * EARTH_R;
    const margin = 40;

    let sawMin = Infinity;
    let sawMax = 0;

    for (let t = 0; t <= 120; t += 4) {
      const when = new Date(Date.now() + t * 60_000);
      const pv = propagate(sat, when);
      assert.ok(pv?.position, `${name}: propagation returned null at +${t} minutes`);

      const r = Math.hypot(pv.position.x, pv.position.y, pv.position.z);
      assert.ok(
        r > perigeeKm - margin,
        `${name}: radius ${r.toFixed(0)} km is below its own perigee ${perigeeKm.toFixed(0)} km`,
      );
      assert.ok(
        r < apogeeKm + margin,
        `${name}: radius ${r.toFixed(0)} km is above its own apogee ${apogeeKm.toFixed(0)} km`,
      );
      sawMin = Math.min(sawMin, r);
      sawMax = Math.max(sawMax, r);
      sampled++;
    }

    // Eccentricity is what makes the orbit an ellipse rather than a circle, and it
    // is the term most easily lost in a transcription error. These orbits are
    // near-circular, so the spread should be a few km - real, but small next to the
    // ~6800 km radius. Deliberately NOT compared against altp/alta: those are the
    // pre-drag estimates sgp4init derives from the mean elements, and they do not
    // bound the propagated orbit (one fixture satellite implies a 2.3 km spread
    // and actually traces 11.3 km).
    const observedSpread = sawMax - sawMin;
    assert.ok(
      observedSpread > 0.5,
      `${name}: spread was only ${observedSpread.toFixed(2)} km, eccentricity looks lost`,
    );
    assert.ok(
      observedSpread < 0.05 * perigeeKm,
      `${name}: spread ${observedSpread.toFixed(1)} km is not near-circular for this altitude`,
    );
  }

  assert.equal(sampled, 4 * 31, "expected 4 element sets x 31 samples");
});

test("the mean motion implies a low-Earth-orbit period", async () => {
  // Guards the secular terms. A transcription error in the mean motion field
  // still returns plausible coordinates, but the orbit period becomes nonsense.
  const { twoline2satrec } = await import(join(SATELLITE_JS, "dist/io.js"));

  for (const { name, line1, line2 } of elementSets()) {
    const sat = twoline2satrec(line1, line2);
    const periodMin = (2 * Math.PI) / sat.no;
    assert.ok(
      periodMin > 85 && periodMin < 100,
      `${name}: implied period ${periodMin.toFixed(1)} min; LEO is about 92`,
    );
  }
});

test("propagated positions complete an orbit in about the implied period", async () => {
  // The same property, measured from the output rather than read off the mean
  // motion. Successive upcrossings of the mean radius are one per revolution,
  // which is a robust period detector; comparing radii to the starting radius is
  // not, because near an apsis the radius barely moves and a spurious match turns
  // up almost immediately.
  const { propagate } = await import(join(SATELLITE_JS, "dist/propagation.js"));
  const { twoline2satrec } = await import(join(SATELLITE_JS, "dist/io.js"));

  const { name, line1, line2 } = elementSets()[0];
  const sat = twoline2satrec(line1, line2);
  const meanKm = ((1 + (sat.altp + sat.alta) / 2)) * 6378.135;

  const radiusAt = (minutes) => {
    const pv = propagate(sat, new Date(Date.now() + minutes * 60_000));
    assert.ok(pv?.position, `propagation returned null at +${minutes} minutes`);
    return Math.hypot(pv.position.x, pv.position.y, pv.position.z);
  };

  const crossings = [];
  let previous = radiusAt(0) - meanKm;
  for (let t = 2; t <= 200; t += 2) {
    const current = radiusAt(t) - meanKm;
    if (previous <= 0 && current > 0) crossings.push(t);
    previous = current;
  }

  assert.ok(crossings.length >= 2, `${name}: only ${crossings.length} orbit crossings in 200 minutes`);
  const period = crossings[1] - crossings[0];
  assert.ok(
    period > 80 && period < 105,
    `${name}: measured period ${period} min; the element set implies ${((2 * Math.PI) / sat.no).toFixed(1)} min`,
  );
});

test("the parser rejects corrupt element sets, because satellite.js will not", async () => {
  // satellite.js's twoline2satrec returns a record for almost anything: prose, a
  // reversed pair, a truncated line, an empty string. It propagates them to
  // positions with NaN components, and `NaN >= minElevation` is false rather than
  // an error, so the failure is invisible - the satellite simply never appears
  // above the horizon. So rejection is asserted on OUR parser, which is the only
  // place it can happen.
  const { parseTles } = await import("../../src/lib/feeds/passes-client.ts");
  const good = elementSets()[0];

  const cases = [
    ["corrupt line 1", { line1: good.line1.slice(0, -1) + "4", line2: good.line2 }],
    ["corrupt line 2", { line1: good.line1, line2: good.line2.slice(0, -1) + "0" }],
    ["reversed lines", { line1: good.line2, line2: good.line1 }],
    ["blank line 2", { line1: good.line1, line2: "2 " }],
    ["truncated line 1", { line1: good.line1.slice(0, 40), line2: good.line2 }],
    ["prose, not a TLE", { line1: "MYSTERY", line2: good.line2 }],
  ];

  for (const [label, { line1, line2 }] of cases) {
    const out = parseTles(`${line1}\n${line2}\n`);
    assert.equal(
      out.length,
      0,
      `${label} should be rejected, got ${out.length} element set(s)`,
    );
  }
});

test("the parser keeps every valid element set in a real payload", async () => {
  // The counterweight to the guard above: validation that rejects good records is
  // worse than no validation, because the layer just quietly shows fewer
  // satellites. Every record in the captured payload must survive.
  const { parseTles } = await import("../../src/lib/feeds/passes-client.ts");
  const parsed = parseTles(FIXTURE);

  assert.equal(parsed.length, elementSets().length, "a valid record was dropped");
  for (const { name, line1 } of elementSets()) {
    assert.ok(
      parsed.some((p) => p.line1 === line1),
      `${name} was dropped by validation`,
    );
  }
  // Names must survive too, since the popup shows them.
  assert.deepEqual(
    parsed.map((p) => p.name).sort(),
    elementSets().map((s) => s.name).sort(),
  );
});

test("every element set that reaches propagation produces a finite position", async () => {
  // The end-to-end guard. Parsing, validating and propagating in sequence, with no
  // NaN anywhere, is what the worker depends on: a NaN elevation would compare
  // false against the minimum elevation and silently delete the satellite.
  const { parseTles } = await import("../../src/lib/feeds/passes-client.ts");
  const { propagate } = await import(join(SATELLITE_JS, "dist/propagation.js"));
  const { twoline2satrec } = await import(join(SATELLITE_JS, "dist/io.js"));

  for (const { line1, line2 } of parseTles(FIXTURE)) {
    const sat = twoline2satrec(line1, line2);
    assert.ok(sat, `failed to parse: ${line1}`);
    for (const hours of [0, 1, 6, 12, 24]) {
      const pv = propagate(sat, new Date(Date.now() + hours * 3_600_000));
      assert.ok(pv?.position, `no position at +${hours}h for ${line1}`);
      for (const axis of ["x", "y", "z"]) {
        assert.ok(
          Number.isFinite(pv.position[axis]),
          `position.${axis} was ${pv.position[axis]} at +${hours}h for ${line1}`,
        );
        assert.ok(
          Number.isFinite(pv.velocity[axis]),
          `velocity.${axis} was ${pv.velocity[axis]} at +${hours}h for ${line1}`,
        );
      }
    }
  }
});
