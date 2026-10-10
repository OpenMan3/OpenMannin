/**
 * The security headers exist in three places, on purpose:
 *
 *   scripts/static-headers.mjs   the source of truth
 *   public/_headers              generated from it (Cloudflare Pages)
 *   deploy/nginx-security.conf   hand-copied (nginx, because nginx cannot
 *                                import JavaScript)
 *
 * The third one is the risk. Nothing regenerates it, and nginx silently drops
 * inherited headers the moment a location declares its own - which is exactly
 * how /maplibre-gl-worker.mjs once ended up serving without a CSP. So the CSP
 * string is asserted here, byte for byte, and the nginx config is asserted to
 * actually include the snippet everywhere it needs to.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  CACHE_RULES,
  cacheControlFor,
  headersFileContents,
} from "../static-headers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("the CSP names every origin the browser actually fetches from", () => {
  // Each of these failing in production looks like an app bug: a blank
  // basemap, an empty weather layer, TLEs that never arrive.
  for (const origin of [
    "https://api.open-meteo.com",
    "https://marine-api.open-meteo.com",
    "https://celestrak.org",
    "https://a.tile.openstreetmap.org",
    "https://a.tile.opentopomap.org",
    "https://tiles.openfreemap.org",
    "https://tiles.basemaps.cartocdn.com",
  ]) {
    assert.ok(
      CONTENT_SECURITY_POLICY.includes(`connect-src`) && CONTENT_SECURITY_POLICY.includes(origin),
      `connect-src is missing ${origin}`,
    );
  }
  assert.match(CONTENT_SECURITY_POLICY, /worker-src 'self' blob:/);
  assert.match(CONTENT_SECURITY_POLICY, /img-src [^;]*https:\/\/images\.gov\.im/);
  // No eval in the app or maplibre (grep-verified when this was written), so
  // do not pay for it. If a dependency starts needing it, `npm run smoke`
  // reports the violation - widen this consciously, not by accident.
  assert.ok(!CONTENT_SECURITY_POLICY.includes("unsafe-eval"));
});

test("nginx-security.conf carries the identical CSP", () => {
  const nginx = fs.readFileSync(path.join(ROOT, "deploy", "nginx-security.conf"), "utf8");
  assert.ok(
    nginx.includes(`add_header Content-Security-Policy "${CONTENT_SECURITY_POLICY}" always;`),
    "deploy/nginx-security.conf CSP differs from scripts/static-headers.mjs - copy it across again",
  );
  for (const name of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Strict-Transport-Security"]) {
    assert.ok(nginx.includes(name), `nginx snippet is missing ${name}`);
  }
});

test("nginx.conf re-includes the snippet in every location that sets a header", () => {
  const conf = fs.readFileSync(path.join(ROOT, "deploy", "nginx.conf"), "utf8");
  const include = "include /etc/nginx/snippets/openmannin-security.conf;";

  // Server level must include it, or nothing below inherits anything.
  assert.ok(conf.includes(include), "nginx.conf never includes the security snippet");

  // Split into location blocks and check each one that declares add_header.
  const locations = conf.split(/\n(?=    location )/).slice(1);
  assert.ok(locations.length >= 5, "expected the full location set in nginx.conf");
  for (const block of locations) {
    if (!/add_header /.test(block)) continue;
    const name = block.match(/location [^\n{]+/)?.[0]?.trim();
    assert.ok(block.includes(include), `${name} sets add_header without re-including the snippet`);
  }
});

test("the generated _headers file matches the source of truth", () => {
  const expected = headersFileContents();
  assert.equal(
    fs.readFileSync(path.join(ROOT, "public", "_headers"), "utf8"),
    expected,
    "public/_headers is stale - run `npm run build:headers`",
  );
  for (const [, value] of SECURITY_HEADERS) {
    assert.ok(expected.includes(value), "a security header did not make it into _headers");
  }
});

test("cache rules match the documented table in DEPLOY.md", () => {
  assert.equal(cacheControlFor("/_next/static/chunks/abc.js"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlFor("/health.json"), "no-cache");
  assert.equal(cacheControlFor("/data/roads.geojson"), "public, max-age=3600, must-revalidate");
  assert.equal(cacheControlFor("/index.html"), "public, max-age=0, must-revalidate");
  // Longest prefix wins: a path under /_next/static/ must not fall through to
  // the catch-all just because it also starts with a slash.
  assert.equal(CACHE_RULES.length, 4);
});
