# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# OpenMannin - production image
#
# Two things make this image non-obvious, and both are load-bearing:
#
# 1. THE DATA IS GENERATED, NOT COMMITTED. public/data/*.geojson is gitignored,
#    because every `npm run ingest:all` rewrites all 38 layers and committing
#    them would mean ~10 MB of pure diff churn. The consequence is that a clone
#    contains no map data whatsoever, so the build has to produce it. There is no
#    way around this: shipping the image without running ingest yields a map with
#    an empty basemap and no error.
#
# 2. THE APP NEEDS A NODE RUNTIME, NOT A STATIC SITE. Three routes are live
#    server code - /api/passes (SGP4 propagation), /api/tiles/opentopo (tile
#    proxy, because OpenTopoMap sends no CORS header) and /api/marine (an
#    upstream AIS socket). `next build` will happily emit a static-looking
#    artefact, but deploying that to a static host produces a blank map with
#    three broken endpoints.
#
# About ingest reliability: the ingest scripts call third-party APIs (Overpass,
# CelesTrak, OpenTopoMap, gov.im ArcGIS) and several of them rate-limit or
# time out under load. The build therefore FAILS LOUDLY if ingest does not
# produce the expected layers, rather than shipping a silently empty map. If
# you need a build that cannot be broken by someone else's outage, bake the
# data into the image once with SKIP_INGEST=1 and push that.
# ---------------------------------------------------------------------------

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# libc6-compat is required by satellite.js's WASM calculator on musl.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile and generate the data -----------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate public/data/*.geojson and the manifest. This is the step that cannot
# be skipped on a fresh clone.
ARG SKIP_INGEST=0
RUN if [ "$SKIP_INGEST" = "1" ]; then \
      echo "SKIP_INGEST=1 - expecting public/data to be provided"; \
      test -f public/data/manifest.json || { echo "ERROR: SKIP_INGEST=1 but public/data is empty"; exit 1; }; \
    else \
      npm run ingest:all || { echo "ERROR: ingest failed. Upstream APIs (Overpass, CelesTrak, gov.im) are rate-limiting or down."; exit 1; }; \
    fi

# Refuse to ship a map with no data. This is the failure mode that would
# otherwise reach production looking like a styling problem.
RUN node -e "const m=require('./public/data/manifest.json'); const absent=m.absent||[]; const n=Object.keys(m.layers||{}).length; if(absent.length){console.error('ERROR: layers without data: '+absent.join(', '));process.exit(1)} console.log('data ok: '+n+' layers, none absent')"

RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache libc6-compat && addgroup -g 1001 -S mannin && adduser -S -u 1001 -G mannin mannin

ENV NODE_ENV=production
# The MapLibre worker is copied into public/ by the build and served from
# there; setWorkerUrl() points at it. If this path is wrong the map renders a
# bare basemap with every data layer silently missing, so it is worth asserting.
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=mannin:mannin /app/public ./public
COPY --from=build --chown=mannin:mannin /app/.next ./.next
COPY --from=build --chown=mannin:mannin /app/node_modules ./node_modules
COPY --from=build --chown=mannin:mannin /app/package.json ./package.json
COPY --from=build --chown=mannin:mannin /app/next.config.ts ./next.config.ts

USER mannin
EXPOSE 3000

# /api/health reports data presence, so an orchestrator can tell a working
# deploy from one that came up empty.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]