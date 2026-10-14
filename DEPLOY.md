# Deploying OpenMannin

## Read this first: what this deploy actually is

**It is a static site, and that is deliberate.** `next build` with
`output: "export"` writes files into `out/` - HTML, bundled JS, and the data
layers. There is no server:

- `next start` **refuses to serve this build** (it only serves the non-export
  runtime). The app's own file server is `scripts/serve.mjs`, run by
  `npm start`, the Docker image, Fly.io and the systemd unit.
- The seven `/api/*` routes that used to exist were deleted along with the
  server they needed. Satellite passes moved into the browser (its upstream
  sends `Access-Control-Allow-Origin: *`); feeds that would need a server or
  whose licence is not free for commercial use - proprietary AIS, OpenSky,
  FindMyBus, Open-Meteo weather, Met Office data - have been **removed** rather
  than left half-stubbed.
- **There are no environment variables and no secrets.**

Deploy `out/` to any static host and the map works: basemap, all data
layers, satellite passes.

**Two things still rule out a lazy deploy:**

**1. The data may not be in your clone.** `public/data/*.geojson` is generated
by `npm run ingest:all`. Whether it is committed in your copy of the repo,
gitignored, or absent determines whether your build must ingest:

```bash
ls public/data/manifest.json     # present -> you can build immediately
npm run ingest:all               # absent  -> run this first (needs network)
```

**2. The security headers must be sent by the host.** A static export has no
`headers()` hook. They live in exactly one place - `scripts/static-headers.mjs` -
which generates `public/_headers` (Cloudflare Pages) and is imported by
`scripts/serve.mjs` (everything else) and asserted against
`deploy/nginx-security.conf` by `npm test`. **If you deploy to a third kind of
host, send those headers there too, or you lose the CSP silently.**

## Requirements

- **Node 26** (CI and Docker default; Next 16 requires >= 20.9.0 but the gap row above was the real failure, so develop and ship on 26)
- Network access **at build time only**, for the ingest step
- No runtime requirements beyond serving files: no database, no process state

## Refreshing Overture Maps data safely

Overture is ingested from a pinned release by `scripts/lib/overture-release.mjs`.

To accept a new upstream release, update that constant explicitly and treat all
downstream artifacts as part of the same change:

1. Inspect the release identifier (currently expected as `YYYY-MM.D`):
   `node -e "fetch('https://stac.overturemaps.org/catalog.json').then(r=>r.json()).then(c=>console.log(c.latest))"`
2. Update `OVERTURE_RELEASE` in `scripts/lib/overture-release.mjs`.
3. Run `npm run ingest:overture`.
4. Refresh derived artifacts:
   `npm run build:manifest`
   `npm run build:search`
   `npm run build:sources`
5. Re-run `npm run verify:registry`.
   If the feature count changed, update `featureCount` in `src/lib/layers.ts`.
6. Run `npm test`, `npm run typecheck`, and `npm run lint`.

The ingest deliberately does not follow STAC `latest` silently, so a routine
`npm run ingest:all` cannot move Overture between releases.

## Build

```bash
npm ci
npm run ingest:all     # if public/data is empty
npm run build          # writes out/, runs the health report and headers first
```

`npm run build` runs, in order: the MapLibre worker copy, the satellite pass
worker bundle, `public/_headers`, `public/health.json`, then `next build`.
**The build fails** if any layer has no data, if either worker is missing, or
if `public/_headers` has no CSP - each of those produces a map that looks
broken rather than a build that looks failed.

To run it locally:

```bash
npm start              # scripts/serve.mjs, http://localhost:3000
PORT=4000 npm start    # the only setting it reads
```

## Caching, by design

Both header producers use the same table (`CACHE_RULES` in
`scripts/static-headers.mjs`):

| Path | Cache-Control | Why |
|---|---|---|
| `/_next/static/*` | `public, max-age=31536000, immutable` | content-hashed filenames can never be stale |
| `/data/*` | `public, max-age=3600, must-revalidate` | ~10 MB of GeoJSON, changes only on ingest |
| `/health.json` | `no-cache` | a redeploy must be visible on the first request |
| everything else | `public, max-age=0, must-revalidate` | revalidate by ETag |

If you put a CDN in front, match these. A cache-everything rule on `/data/`
that ignores the revalidation will pin a stale island; one on `/health.json`
will hide a broken deploy.

## Option A: Cloudflare Pages (recommended)

The intended target: no process, no bill for idle time, headers applied at the
edge from `public/_headers`.

1. Point a Pages project at this repository (or upload `out/` with
   `wrangler pages deploy out`).
2. Build command: `npm run ingest:all && npm run build`
3. Output directory: `out`

Nothing else to configure - no functions, no environment variables, no headers
to paste (they ship in the output).

## Option B: Docker

The image runs ingest inside the build, so it works from a clone with no data:

```bash
docker build -t openmannin .          # runs ingest; fails loudly if it fails
docker run -p 3000:3000 openmannin
# or
docker compose up -d
```

Check it came up whole:

```bash
curl -s localhost:3000/health.json | python3 -m json.tool
```

`"ok": true` requires the MapLibre worker, the passes worker, the headers file
and every registered layer to have been present at **build** time. A container
whose build skipped those answers `ok: false`, and the platform health check
pulls it from rotation.

### Ingest is the fragile step

The ingest scripts call third-party APIs (Overpass, CelesTrak, gov.im) and
several rate-limit or time out. The build fails loudly rather than shipping an
empty map - deliberate, but it means a build can fail for reasons unrelated to
your code. For builds that cannot be broken by someone else's outage, bake the
data into the build context:

```bash
npm run ingest:all
docker build --build-arg SKIP_INGEST=1 -t openmannin .
# The Dockerfile refuses SKIP_INGEST=1 if public/data/manifest.json is absent
# from the context. .dockerignore deliberately does NOT filter public/data.
```

> Verified: `docker build --build-arg SKIP_INGEST=1` and a full run of `npm run build` inside the image both succeed; `/health.json` comes back `ok: true`. The fragile step remains ingest — see below.

## Option C: Fly.io

`fly.toml` is committed and parses as TOML. It is a Docker build (Option B's
Dockerfile), so the same ingest caveat applies to every deploy:

```bash
fly launch --no-deploy      # first time only
fly deploy
fly status
```

Health check is `GET /health.json`. `auto_stop_machines = "off"` with
`min_machines_running = 1` keeps one machine up; there is no expensive cold
start any more, so the only thing this buys is not refusing the first request
of the day.

## Option D: VPS with nginx

nginx serves `out/` straight off disk - no upstream, no proxy:

```bash
sudo useradd --system --home /opt/openmannin --shell /usr/sbin/nologin openmannin
sudo -u openmannin git clone <repo> /opt/openmannin
cd /opt/openmannin
sudo -u openmannin npm ci
sudo -u openmannin npm run ingest:all      # only if public/data is empty
sudo -u openmannin npm run build

sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx-security.conf /etc/nginx/snippets/openmannin-security.conf
sudo cp deploy/nginx.conf /etc/nginx/sites-available/openmannin
sudo ln -s /etc/nginx/sites-available/openmannin /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Edit `root` in `deploy/nginx.conf` if `out/` is not at `/opt/openmannin/out`.

Two things the nginx config deliberately gets right:

- the three worker bundles are served as `text/javascript`. If they arrive as
  `text/html` the browser refuses them and **every data layer silently
  disappears** while the basemap keeps drawing - a bug already seen once
  through a misconfigured proxy;
- every `location` that sets its own `Cache-Control` re-includes the security
  snippet, because nginx drops inherited `add_header` directives the moment a
  location declares any of its own.

`deploy/openmannin.service` (systemd) is an alternative to nginx for hosts
without it: it runs `scripts/serve.mjs` against the same `out/` directory with
the same headers. **Do not run both pointed at the same port**; with nginx
serving static files, the unit is optional. It passes
`systemd-analyze verify`, which is worth re-running on your target host - that
check is what caught the original hardcoded `ExecStart=/usr/bin/npm`.

## Checks to run before you trust a change

```bash
npm test              # unit tests, including the nginx-vs-static-headers check
npm run typecheck     # tsc --noEmit
npm run verify:registry
npm run build         # fails if data, workers or headers are missing

npm run smoke         # needs a server already running (see below)
npm run smoke:live
npm run verify:render
npm run verify:basemap
```

The browser-driven checks need a production build being served - they cannot
run against `next dev`:

```bash
npm run build && PORT=3111 npm start
npm run smoke -- http://localhost:3111/
```

## Verifying a deploy

```bash
curl -s https://your-host/health.json | python3 -m json.tool
```

Check, in order:

1. `"ok": true` - otherwise something below failed at build time.
2. `"worker": true` - otherwise every data layer is invisible while the
   basemap still draws. This is the failure that cost the most time so far.
3. `"absent": []` - no registered layer without data.
4. `"features"` - a plausible number (currently ~43,600). Small means ingest
   partially failed and you have a half-empty island.

Then load the page and confirm:

- the attribution control credits the basemap provider (OpenFreeMap,
  OpenMapTiles, OpenStreetMap);
- the browser console has no Content-Security-Policy violations (a `connect-src`
  violation means the host is not sending the headers - see the top of this
  file);
- the satellite-passes layer loads data without any configuration.

## What is verified, and what is not

Honest accounting, because two of these gaps produced real bugs already.

| Checked | How |
|---|---|
| `npm test` | the full unit-test suite, including one that fails if `deploy/nginx-security.conf` drifts from `scripts/static-headers.mjs` |
| `fly.toml` | parses as TOML; health path and env read back |
| `openmannin.service` | `systemd-analyze verify` passes clean |
| `docker-compose.yml` | parses as YAML |
| `serve.mjs` | exercised by hand: CSP/nosniff present, gzip, ETag/304, 404, 405, traversal blocked, `.mjs` typed `text/javascript` |
| `nginx.conf` | `nginx -t` clean against nginx:alpine, include paths for security snippet resolvable. Still re-run on the target host (cert paths are not exercised in CI) |
| Docker image | Built end-to-end with `--build-arg SKIP_INGEST=1` against the committed `public/data/`; `/health.json` returns `ok: true`, `worker: true`, `absent: []`. Full-ingest build path not re-run here, but Dockerfile ingest step is unchanged. |
| API routes | every one exercised against the production build before they were deleted; the deletion is covered by the export assertions above |
| Node version | developed and deployed on Node 26 — CI pin and Docker default agree (after the Phase A bump) |

Now tested and deployed on Node 26 in both CI (`.github/workflows/ci.yml`) and
the image default (`Dockerfile` `ARG NODE_VERSION=26-alpine`). 22 remains
supported by Next 16 but is no longer the image default, so the "validated on
X, deployed on Y" gap is closed.

## Operational notes

- **Attribution is a licence obligation, not decoration.** The OpenFreeMap
  Liberty basemap is ODbL (data © OpenStreetMap contributors, style ©
  OpenMapTiles), and `verify:basemap` asserts that the attribution control
  credits it.
- **Every source must be free for any use, including commercial.** Open-Meteo's
  free tier was NON-COMMERCIAL and has been removed, as was the Met Office
  DataHub (paid key). A CC-BY-NC licence identifies data that cannot be used
  here. CelesTrak is public domain and re-read every 6 hours by each visitor's
  browser; no credentials, no rotation.
- **If you add a live feed later**, check both its licence and its CORS:
  update `scripts/static-headers.mjs` (`connect-src`) in the same change, or
  the CSP will block it and the failure will look like an app bug.
