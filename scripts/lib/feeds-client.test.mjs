/**
 * Tests for the client-side live feeds.
 *
 * The parsing here is NEW - it moved out of a server route into the browser when
 * the app became a static export - so it has no coverage from the tests that
 * exercised the routes. A regression would be silent: a malformed TLE block that
 * gets skipped wrongly removes satellites from the pass layer, and an absent
 * satellite layer looks exactly like "nothing is overhead right now".
 *
 * The convention in this repo is that each guard must have a test which FAILS
 * when the guard is removed. That is what the "survives" tests below are for.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";

// These run under --experimental-strip-types, so the .ts module is imported
// directly. parseTles is exported separately from the fetcher precisely so it
// can be tested without a DOM, a worker or a network.
import { parseTles } from "../../src/lib/feeds/passes-client.ts";

/**
 * The REAL wire format, captured from CelesTrak.
 *
 * There are NO BLANK LINES between records. Every line ends CRLF and the name
 * is space-padded to a fixed width. That is the detail this fixture exists to
 * pin down, because the original implementation split on blank lines and
 * returned 1 element set from this payload's 2 satellites.
 */
/**
 * The remaining fixture records, read from disk rather than retyped.
 *
 * Element sets carry a trailing checksum, so a transcription slip anywhere in a
 * line makes it invalid - and an earlier version of this file had exactly that,
 * which showed up as three puzzling test failures. Reading the lines means these
 * tests cannot disagree with the fixture they claim to describe.
 */
const FIXTURE_RECORDS = readFileSync(
  new URL("./fixtures/celestrak-stations.tle", import.meta.url),
  "utf8",
)
  .split(/\r?\n/)
  .filter((line) => line.startsWith("1 ") || line.startsWith("2 "));

const TIANHE = FIXTURE_RECORDS.slice(4, 6);
const NAUKA = FIXTURE_RECORDS.slice(6, 8);

/** The individual records of REAL_TLE, for tests that need them apart. */
const REAL_ELEMENT_SETS = [
  { name: "ISS (ZARYA)", line1: FIXTURE_RECORDS[0], line2: FIXTURE_RECORDS[1] },
  { name: "POISK", line1: FIXTURE_RECORDS[2], line2: FIXTURE_RECORDS[3] },
  { name: "CSS (TIANHE)", line1: TIANHE[0], line2: TIANHE[1] },
  { name: "ISS (NAUKA)", line1: NAUKA[0], line2: NAUKA[1] },
];

// The first two fixture records in the real wire format: names, space-padded to
// their fixed width, CRLF, and crucially NO blank lines between records.
const REAL_TLE = (() => {
  const pairs = [
    ["ISS (ZARYA)             ", FIXTURE_RECORDS[0], FIXTURE_RECORDS[1]],
    ["POISK                   ", FIXTURE_RECORDS[2], FIXTURE_RECORDS[3]],
  ];
  return pairs.map((p) => p.join("\r\n")).join("\r\n") + "\r\n";
})();

test("parses every element set from the real no-blank-line GP format", () => {
  const tles = parseTles(REAL_TLE);
  assert.equal(tles.length, 2, "the format has no blank lines between records");
  assert.equal(tles[0].name, "ISS (ZARYA)");
  assert.match(tles[0].line1, /^1 25544U/);
  assert.equal(
    tles[0].line2,
    "2 25544  51.6316 116.4131 0006856 223.9771 136.0673 15.48738655588781",
  );
  assert.equal(tles[1].name, "POISK");
});

test("no field keeps a carriage return", () => {
  // satellite.js is not tolerant of one. A CR at the end of line2 makes the
  // checksum field wrong and the element set silently unusable.
  for (const tle of parseTles(REAL_TLE)) {
    for (const field of [tle.name, tle.line1, tle.line2]) {
      assert.ok(!field.includes("\r"), `CR survived in "${field}"`);
    }
  }
});

test("the space-padded name is trimmed but not otherwise mangled", () => {
  assert.equal(parseTles(REAL_TLE)[0].name, "ISS (ZARYA)");
});

test("an element set with no name line still parses, under a synthesised name", () => {
  // Better than dropping the satellite: an unnamed craft still has a valid orbit,
  // and the popup labels it by NORAD id rather than losing the layer entry.
  const [good] = REAL_ELEMENT_SETS;
  const out = parseTles(`${good.line1}\n${good.line2}\n`);
  assert.equal(out.length, 1);
  assert.match(out[0].name, /25544/);
});

test("a '2 ' line is never mistaken for the next element set's name", () => {
  const out = parseTles(REAL_TLE);
  assert.ok(!out.some((t) => t.name.startsWith("2 ")));
  assert.ok(!out.some((t) => t.name.startsWith("1 ")));
});

test("survives a payload that DOES use blank-line separators", () => {
  // Belt and braces: some CelesTrak endpoints and mirrors emit the legacy
  // blank-line-separated form. Both must yield the same element sets.
  const blank = REAL_TLE.replace(/\r\n/g, "\n").replace(/(1 \d\d\d\d\dU[^\n]*)\n(2 )/g, "$1\n\n$2");
  assert.equal(parseTles(blank).length, 2);
});

test("a record whose lines are not 1/2 prefixed is rejected", () => {
  // Regression guard for the startsWith checks. Without them this block would
  // parse into a satellite whose line1 is prose, and twoline2satrec would
  // either throw or - worse - produce a plausible-looking position.
  const out = parseTles(`MYSTERY
3 25544U 98067A   24001.50000000  .00016717
4 25544  51.6400 100.0000 0001000  50.0000 100.0000 15.50000000
`);
  assert.equal(out.length, 0);
});

test("a '2 ' line with no '1 ' above it is ignored, not promoted to a satellite", () => {
  // The asymmetry matters. A stray line 2 with no line 1 above it means the
  // payload is truncated or malformed, and treating it as an element set would
  // produce a satellite whose line1 is actually some other record's name.
  const [good, second] = REAL_ELEMENT_SETS;
  const out = parseTles(
    `ISS (ZARYA)\r\n${good.line1}\r\n${good.line2}\r\n2 36086  99.0000\r\n${second.line1}\r\n${second.line2}\r\n`,
  );
  assert.equal(out.length, 2, "the stray line 2 must not swallow the next record");
  assert.equal(out[0].name, "ISS (ZARYA)");
  // The stray line 2 is consumed as the tail of the previous record, so the name
  // line of the next one is gone and the parser falls back to the NORAD form. The
  // element set itself is intact, which is the part that matters.
  assert.match(out[1].name, /36086/);
  assert.equal(out[1].line1, second.line1);
});

test("one malformed element set does not discard the others", () => {
  // The important resilience property: a single bad element set from upstream must
  // cost one satellite, not the whole layer. The corrupt record is in the middle,
  // where a parser that bailed out on first error would lose the trailing one too.
  const [first, second, , last] = REAL_ELEMENT_SETS;
  const corrupt = { line1: second.line1.slice(0, -1) + "4", line2: second.line2 };
  const payload = [
    "ISS (ZARYA)",
    first.line1,
    first.line2,
    "GARBAGE BLOCK",
    "this line is prose, not an element set",
    "POISK",
    corrupt.line1,
    corrupt.line2,
    "CSS (TIANHE)",
    last.line1,
    last.line2,
    "",
  ].join("\r\n");

  const out = parseTles(payload);
  assert.equal(out.length, 2, "both well-formed element sets survive the bad one between them");
  assert.equal(out[0].name, "ISS (ZARYA)");
  assert.equal(out[1].name, "CSS (TIANHE)", "the name after garbage is still recovered");
});

test("tolerates stray blank lines anywhere in the payload", () => {
  const spaced = REAL_TLE.replace(/\r\n/g, "\r\n\r\n");
  assert.equal(parseTles(spaced).length, 2);
});

test("an empty or whitespace payload yields nothing rather than throwing", () => {
  // This is the input that stops a bad upstream response being cached for six
  // hours. An exception here is caught by fetchTles; an empty array is the
  // signal it uses to decide the payload is unusable.
  assert.deepEqual(parseTles(""), []);
  assert.deepEqual(parseTles("   \n\n  \n"), []);
});

// ---------------------------------------------------------------------------
// The worker and the client fetcher
// ---------------------------------------------------------------------------

test("the pass layer loads a built worker from public/, not the .ts source", () => {
  // `new Worker(new URL("./passes-worker.ts", import.meta.url), {type:"module"})`
  // is the idiomatic form and it works in dev. In a static export the bundler
  // copies the TypeScript through as an asset with a .ts extension, the host
  // serves it as video/mp2t, and the browser refuses to execute it. The worker
  // then never replies and the layer is silently empty - which reads exactly like
  // the documented caveat about orbital geometry.
  const src = readFileSync(
    new URL("../../src/lib/feeds/passes-client.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    src,
    /new Worker\(\s*new URL\([^)]*\.ts/,
    "the worker must not be constructed from a .ts source path",
  );
  assert.match(
    src,
    /new Worker\(\s*"\/passes-worker\.mjs"/,
    "the worker must be loaded from the bundled copy in public/",
  );

  // And the artifact that path names has to exist, or this is a 404 at runtime.
  const built = new URL("../../public/passes-worker.mjs", import.meta.url);
  assert.ok(existsSync(built), "public/passes-worker.mjs is missing - run npm run build:passes-worker");
  assert.ok(
    statSync(built).mtimeMs >= statSync(
      new URL("../../src/lib/feeds/passes-worker.ts", import.meta.url),
    ).mtimeMs,
    "public/passes-worker.mjs is stale - rebuild it",
  );
});

test("only genuinely client-safe feeds are in the client allowlist", () => {
  // This is the security-relevant assertion. If a credentialed feed were ever
  // added to CLIENT_FEEDS it would be fetched from the browser, which publishes
  // the key. The three that need a server are asserted here by exclusion.
  const src = readFileSync(
    new URL("../../src/lib/feeds/index.ts", import.meta.url),
    "utf8",
  );
  // Anchor on the const, then take everything up to the line that closes it.
  // A non-greedy match to the first `\n};` is fragile against reformatting, so
  // the block is located by line instead.
  const start = src.indexOf("const CLIENT_FEEDS");
  assert.ok(start > -1, "CLIENT_FEEDS allowlist not found in src/lib/feeds/index.ts");
  const end = src.indexOf("\n};", start);
  assert.ok(end > start, "CLIENT_FEEDS allowlist is not closed as expected");
  const block = src.slice(start, end);

  const ids = [...block.matchAll(/^\s*"?([\w-]+)"?\s*:/gm)].map((m) => m[1]);

  assert.deepEqual(
    ids.sort(),
    ["satellite-passes", "weather"],
    "the client allowlist changed; every entry must be checked for CORS `*` AND no credential",
  );
});