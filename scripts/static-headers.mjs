/**
 * Security and cache headers for the static export - one source of truth.
 *
 * There are two (and only two) places these have to be declared:
 *
 *   - public/_headers, read by Cloudflare Pages (and Netlify-compatible hosts);
 *   - scripts/serve.mjs, the zero-dependency file server used by `npm start`,
 *     the Docker image, Fly.io and the systemd unit.
 *
 * Writing them twice by hand is how they drift, so this module owns the text
 * and both consumers import it. `npm run build` regenerates public/_headers.
 *
 * WHY THE CSP IS THIS SHAPE.
 *
 * The map now talks to third-party origins FROM THE BROWSER: satellite passes
 * to CelesTrak, basemap tiles to OpenFreeMap, glyphs to Carto. An
 * older version of this policy had `connect-src 'self'`, which blanks every
 * one of those requests and is the single easiest way to ship a map that looks
 * like it is broken by itself.
 *
 *   connect-src   those origins plus 'self' for /data/*.geojson.
 *   script-src    'self' plus 'unsafe-inline': the Next static export inlines
 *                 its flight payload in <script> tags (six of them in
 *                 index.html). No 'unsafe-eval' - neither the app chunks nor
 *                 maplibre-gl.mjs contain new Function() or eval(), checked
 *                 with grep at the time of writing. If a future dependency
 *                 needs it, `npm run smoke` reports the CSP violation; do not
 *                 widen this speculatively.
 *   worker-src    'self' for /maplibre-gl-worker.mjs and /passes-worker.mjs,
 *                 blob: because MapLibre falls back to a blob worker when the
 *                 module worker fails to load.
 *   img-src       'self' for icons, data:/blob: for canvas exports.
 *   style-src     'unsafe-inline' because MapLibre writes element.style
 *                 directly rather than inserting stylesheet rules.
 *   frame-ancestors / object-src / base-uri   clickjacking, plugin and
 *                 <base> hijack hardening. frame-ancestors 'self' matches the
 *                 X-Frame-Options below.
 */

/** Origins the browser is allowed to fetch from. */
const CONNECT_SRC = [
  "'self'",
  "https://celestrak.org",
  // Keyless OpenFreeMap vector basemaps: style JSON, vector tiles, sprites and
  // glyphs all come from this one host, fetched by MapLibre via connect-src.
  "https://tiles.openfreemap.org",
  // Carto glyph PBFs referenced by createInitialStyle's GLYPHS.
  "https://tiles.basemaps.cartocdn.com",
  // 3D terrain: AWS Open Data DEM tiles (raster-dem, terrarium). MapLibre
  // fetches these as array buffers, so they need connect-src specifically.
  "https://s3.amazonaws.com",
].join(" ");

/** Origins allowed for <img>, ImageBitmap and canvas tainting. */
const IMG_SRC = ["'self'", "data:", "blob:", "https://s3.amazonaws.com"].join(" ");

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src ${IMG_SRC}`,
  `font-src 'self' data:`,
  `connect-src ${CONNECT_SRC}`,
  `worker-src 'self' blob:`,
  "manifest-src 'self'",
  "form-action 'self'",
].join("; ");

/** Sent on every response, by both consumers. */
export const SECURITY_HEADERS = Object.entries({
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN",
  // geolocation is allowed for our own origin only: the locate-me control asks
  // the browser for the visitor's position. camera/microphone/payment stay off.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=()",
  // Browsers only honour this over HTTPS, so a plain-HTTP LAN preview of
  // serve.mjs is unaffected. Both real hosts redirect to HTTPS first.
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
});

/**
 * Cache rules, most specific first.
 *
 * `/_next/static/*` is content-hashed, so it can be cached for a year without
 * ever being wrong. `/health.json` is a build-time report and must revalidate
 * so a fresh deploy is visible immediately. The GeoJSON layers are ~10 MB
 * total and change only on ingest: an hour of caching with revalidation is the
 * difference between a snappy page and a 10 MB download on every visit.
 *
 * The trailing entry is the fallback. serve.mjs uses it directly; the
 * generated _headers file spells it out as a `/*` rule.
 */
export const CACHE_RULES = [
  { pattern: "/_next/static/*", cacheControl: "public, max-age=31536000, immutable" },
  { pattern: "/health.json", cacheControl: "no-cache" },
  { pattern: "/data/*", cacheControl: "public, max-age=3600, must-revalidate" },
  { pattern: "/*", cacheControl: "public, max-age=0, must-revalidate" },
];

/**
 * The Cache-Control for a request path, applying CACHE_RULES in order.
 * Longest literal prefix wins for the non-wildcard patterns; `*` patterns
 * match on their fixed prefix (so `/data/*.geojson` would be `/data/`).
 */
export function cacheControlFor(urlPath) {
  let best = null;
  let bestLen = -1;
  for (const rule of CACHE_RULES) {
    const prefix = rule.pattern.replace(/\*$/, "");
    if (urlPath.startsWith(prefix) && prefix.length > bestLen) {
      best = rule.cacheControl;
      bestLen = prefix.length;
    }
  }
  return best;
}

/** The contents of public/_headers, for the Cloudflare Pages deploy. */
export function headersFileContents() {
  const lines = ["# Generated by scripts/static-headers.mjs - do not edit by hand.",
    "# scripts/serve.mjs sends the same headers; keep them in sync by editing",
    "# scripts/static-headers.mjs instead of this file."];
  lines.push("", "/*");
  for (const [name, value] of SECURITY_HEADERS) lines.push(`  ${name}: ${value}`);
  for (const rule of CACHE_RULES) {
    lines.push("", rule.pattern);
    lines.push(`  Cache-Control: ${rule.cacheControl}`);
  }
  return lines.join("\n") + "\n";
}

// Run as a script: regenerate public/_headers.
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const out = join(process.cwd(), "public", "_headers");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, headersFileContents());
  console.log(`wrote ${out}`);
}
