# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# OpenMannin - production image
#
# Two things make this image non-obvious, and both are load-bearing:
#
# 1. THE DATA IS GENERATED, NOT NECESSARILY COMMITTED. public/data/*.geojson may
#    be absent from your clone (see .gitignore), because every `npm run
#    ingest:all` rewrites all 39 layers. The consequence is that a clone with no
#    data contains no map data whatsoever, so the build has to produce it. There
#    is no way around this: shipping the image without running ingest yields a
#    map with an empty basemap and no error.
#
# 2. THIS IS A STATIC EXPORT, NOT AN APPLICATION SERVER. `output: "export"`
#    produces files in out/, and `next start` refuses to serve them. The runtime
#    is scripts/serve.mjs - a zero-dependency file server that sends the same
#    security headers as public/_headers. That is why the runtime stage copies
#    out/ and two small scripts and nothing else: no node_modules (the app's
#    dependencies are bundled into the export), no .next directory.
#
# About ingest reliability: the ingest scripts call third-party APIs (Overpass,
# CelesTrak, gov.im ArcGIS) and several of them rate-limit or time out under
# load. The build therefore FAILS LOUDLY if ingest does not produce the expected
# layers, rather than shipping a silently empty map. If you need a build that
# cannot be broken by someone else's outage, bake the data into the context once
# with SKIP_INGEST=1 and push that.
# ---------------------------------------------------------------------------

# ---- deps -------------------------------------------------------------------
# Node version used by every stage. Next 16 requires >=20.9.0.
#
# DISCLOSED MISMATCH: local development and the checks in scripts/ were run on
# Node 26, while the default here is 22 LTS. Nothing in this app uses a
# Node-26-only API, and 22 satisfies Next's floor, but "validated on X,
# deployed on Y" is precisely the gap that hid the MapLibre worker bug and the
# attribution bug. If you can test on 22, do. Otherwise build with
# --build-arg NODE_VERSION=26-alpine to deploy exactly what was verified.
ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# libc6-compat is required by esbuild and satellite.js's WASM calculator on musl.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile and generate the data -----------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate public/data/*.geojson and the manifest. This is the step that cannot
# be skipped on a fresh clone.
ARG SKIP_INGEST=0
RUN if [ "$SKIP_INGEST" = "1" ]; then \
      echo "SKIP_INGEST=1 - expecting public/data to be provided in the build context"; \
      test -f public/data/manifest.json || { echo "ERROR: SKIP_INGEST=1 but public/data is empty"; exit 1; }; \
    else \
      npm run ingest:all || { echo "ERROR: ingest failed. Upstream APIs (Overpass, CelesTrak, gov.im) are rate-limiting or down."; exit 1; }; \
    fi

# Refuse to ship a map with no data. This is the failure mode that would
# otherwise reach production looking like a styling problem.
RUN node -e "const m=require('./public/data/manifest.json'); const absent=m.absent||[]; const n=Object.keys(m.layers||{}).length; if(absent.length){console.error('ERROR: layers without data: '+absent.join(', '));process.exit(1)} console.log('data ok: '+n+' layers, none absent')"

# Runs copy:worker, build:passes-worker, build:health, build:headers, next build.
RUN npm run build

# The export must be complete: index, the MapLibre worker, the passes worker,
# the health report and the headers file. Any of these missing means the page
# loads and something on it silently does not.
RUN for f in out/index.html out/maplibre-gl-worker.mjs out/passes-worker.mjs out/health.json out/_headers out/data/manifest.json; do \
      test -f "$f" || { echo "ERROR: export is missing $f"; exit 1; }; \
    done

# ---- runtime ----------------------------------------------------------------
# Static files and the file server only. No node_modules: the application code
# is already bundled into out/_next, and serve.mjs uses Node builtins alone.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
RUN addgroup -g 1001 -S mannin && adduser -S -u 1001 -G mannin mannin

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

COPY --from=build --chown=mannin:mannin /app/out ./out
COPY --from=build --chown=mannin:mannin /app/scripts/serve.mjs ./scripts/serve.mjs
COPY --from=build --chown=mannin:mannin /app/scripts/static-headers.mjs ./scripts/static-headers.mjs
COPY --from=build --chown=mannin:mannin /app/package.json ./package.json

USER mannin
EXPOSE 3000

# /health.json is a build-time report (written by scripts/build-health.mjs): it
# says whether the MapLibre worker and all 39 layers were present at build time.
# It cannot report anything about a running process - nothing about this
# deployment is dynamic - but it still separates "the export came out whole"
# from "the container is serving a directory that happens to exist".
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health.json').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "scripts/serve.mjs"]
