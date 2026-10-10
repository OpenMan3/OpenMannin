#!/usr/bin/env node
/**
 * Zero-dependency static file server for the `out/` export.
 *
 * WHY THIS EXISTS. `next build` with `output: "export"` produces files, not an
 * application: `next start` refuses to run against it, which left the Docker
 * image, Fly.io and the systemd unit all starting a server that could not
 * serve the artefact they had just built. This script is the runtime for every
 * non-Cloudflare deployment of the same directory, and it sends the same
 * security headers as public/_headers so a deploy does not silently lose the
 * CSP just because it moved hosts.
 *
 * WHAT IT IS NOT. No directory listing, no compression negotiation beyond
 * gzip, no range requests, no rewrites. One page, some GeoJSON and a worker
 * bundle do not need them, and every one of those features is a way to serve
 * the wrong bytes.
 *
 * Usage:  node scripts/serve.mjs [rootDir]
 *         PORT=3000 HOST=0.0.0.0 node scripts/serve.mjs out
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { SECURITY_HEADERS, cacheControlFor } from "./static-headers.mjs";

const ROOT = path.resolve(process.argv[2] ?? "out");
const PORT = Number(process.env.PORT ?? 3111);
const HOST = process.env.HOST ?? "0.0.0.0";

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error(
    `serve.mjs: no index.html in ${ROOT}.\n` +
      `This server only ever serves the static export - run \`npm run build\` first.`,
  );
  process.exit(1);
}

/**
 * Content types. The two that matter most, because getting them wrong is
 * silent rather than loud:
 *
 *   .mjs  text/javascript. If the MapLibre worker is served as text/html the
 *         browser refuses it and every data layer disappears while the basemap
 *         keeps drawing - a bug already hit once through a misconfigured proxy.
 *   .geojson  application/geo+json, which is what it is; JSON would work but
 *         there is no reason to mislabel 10 MB of geometry.
 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pbf": "application/x-protobuf",
  ".wasm": "application/wasm",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".webmanifest": "application/manifest+json",
};

/** Worth gzipping: text-ish and already-tiny media are not. */
const COMPRESSIBLE = /\.(html|htm|txt|js|mjs|css|json|geojson|map|svg|xml|webmanifest)$/;

const COMPRESS_MIN = 1024;

/** path -> { key, gz } for encoded bodies. Keyed by mtime+size so edits show. */
const gzCache = new Map();

function statFile(abs) {
  try {
    const st = fs.statSync(abs);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

function gzBody(abs, st, buf) {
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = gzCache.get(abs);
  if (hit && hit.key === key) return hit.gz;
  const gz = zlib.gzipSync(buf, { level: 6 });
  gzCache.set(abs, { key, gz });
  return gz;
}

/** Resolve a URL path inside ROOT, or null if it escapes. */
function resolvePath(urlPath) {
  // Decode %XX up front: a literal "..%2f" must not survive as an escape, and
  // decoding first is the only way to see it.
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const abs = path.resolve(ROOT, "." + path.posix.normalize("/" + decoded));
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return null;
  return abs;
}

function send(req, res, status, headers, body) {
  res.writeHead(status, headers);
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

const server = http.createServer((req, res) => {
  const started = process.hrtime.bigint();
  const urlPath = (req.url ?? "/").split("?")[0].split("#")[0];

  // Always-on security headers, from the same table as public/_headers.
  const headers = Object.fromEntries(SECURITY_HEADERS);
  headers["Cache-Control"] = cacheControlFor(urlPath) ?? "public, max-age=0, must-revalidate";

  if (req.method !== "GET" && req.method !== "HEAD") {
    headers["Allow"] = "GET, HEAD";
    send(req, res, 405, { ...headers, "Content-Type": "text/plain; charset=utf-8" }, "405 Method Not Allowed\n");
    log(req, urlPath, 405, 0, started);
    return;
  }

  let abs = resolvePath(urlPath === "/" ? "/index.html" : urlPath);
  let status = 200;

  if (abs && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    abs = path.join(abs, "index.html");
  }

  let st = abs ? statFile(abs) : null;
  if (!st) {
    // Next exports a real 404 page; serve it with the right status rather than
    // pretending a missing GeoJSON layer is a valid empty response.
    const notFound = path.join(ROOT, "404.html");
    st = statFile(notFound);
    if (!st) {
      send(req, res, 404, { ...headers, "Content-Type": "text/plain; charset=utf-8" }, "404 Not Found\n");
      log(req, urlPath, 404, 0, started);
      return;
    }
    abs = notFound;
    status = 404;
  }

  const ext = path.extname(abs).toLowerCase();
  headers["Content-Type"] = MIME[ext] ?? "application/octet-stream";
  headers["Last-Modified"] = new Date(st.mtimeMs).toUTCString();
  headers["Content-Length"] = String(st.size);

  // ETag from mtime+size: strong enough for conditional requests without
  // hashing 4 MB of roads on every revalidation.
  const etag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
  headers.ETag = etag;

  const inm = req.headers["if-none-match"];
  const ims = req.headers["if-modified-since"];
  if (
    (inm && inm.split(",").some((t) => t.trim() === etag)) ||
    (!inm && ims && Date.parse(ims) >= Math.floor(st.mtimeMs / 1000) * 1000)
  ) {
    delete headers["Content-Length"];
    send(req, res, 304, headers, "");
    log(req, urlPath, 304, 0, started);
    return;
  }

  let body = fs.readFileSync(abs);
  const acceptEncoding = String(req.headers["accept-encoding"] ?? "");
  if (
    status === 200 &&
    COMPRESSIBLE.test(ext) &&
    st.size >= COMPRESS_MIN &&
    /\bgzip\b/.test(acceptEncoding)
  ) {
    body = gzBody(abs, st, body);
    headers["Content-Length"] = String(body.length);
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
  }

  send(req, res, status, headers, body);
  log(req, urlPath, status, body.length, started);
});

function log(req, urlPath, status, bytes, started) {
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  // One line per request. systemd and Docker both capture stdout, and "why did
  // the client get a 404" is otherwise an unanswered question on a static host.
  console.log(
    `${new Date().toISOString()} ${req.method} ${urlPath} ${status} ${bytes}B ${ms.toFixed(1)}ms`,
  );
}

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`serve.mjs: port ${PORT} is already in use. Set PORT=<n> to change it.`);
  } else {
    console.error(`serve.mjs: ${e.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`serving ${ROOT} on http://${HOST}:${PORT}`);
});
