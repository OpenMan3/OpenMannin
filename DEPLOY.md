# Deploying OpenMannin

## Read this first: what this deploy actually is

**It is a static site, and that is deliberate.** `next build` with
`output: "export"` writes files into `out/` - HTML, bundled JS, and the data
layers. There is no server:

- `next start` **refuses to serve this build** (it only serves the non-export
  runtime). The app's own file server is `scripts/serve.mjs`, run by
  `npm start`, the Docker image, Fly.io and the systemd unit.
- The seven `/api/*` routes that used to exist were deleted along with the
  server they needed. Weather and satellite passes moved into the browser
  (their upstreams send `Access-Control-Allow-Origin: *`); the three feeds that
  cannot work without a server - OpenSky, AISStream, FindMyBus - are **on
  hold**: the map makes no request for them and the layer panel says why.
- **There are no environment variables and no secrets.** If a document tells
  you to set `AISSTREAM_API_KEY`, it is describing a version of the app that no
  longer has `/api/marine`.

Deploy `out/` to any static host and the map works: basemap, all 39 data
layers, weather, satellite passes.

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

- **Node 22+** (Next 16 requires >=20.9.0)
- Network access **at build time only**, for the ingest step
- No runtime requirements beyond serving files: no database, no process state

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

> **The image build is untested in anger.** The Docker daemon was not reachable
> where this was written. The likeliest failure is the ingest step, not the
> Docker syntax.

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
4. `"features"` - a plausible number (currently ~38,400). Small means ingest
   partially failed and you have a half-empty island.
5. `"hosting.onHold"` - the three feeds that make no request anywhere. They
   are expected; the layer panel explains each one in the UI.

Then load the page and confirm:

- the attribution control credits whoever served the basemap you selected, and
  changes when you switch basemaps;
- the browser console has no Content-Security-Policy violations (a `connect-src`
  violation means the host is not sending the headers - see the top of this
  file);
- the satellite-passes and weather layers load data without any configuration.

## What is verified, and what is not

Honest accounting, because two of these gaps produced real bugs already.

| Checked | How |
|---|---|
| `npm test` | the full unit-test suite, including one that fails if `deploy/nginx-security.conf` drifts from `scripts/static-headers.mjs` |
| `fly.toml` | parses as TOML; health path and env read back |
| `openmannin.service` | `systemd-analyze verify` passes clean |
| `docker-compose.yml` | parses as YAML |
| `serve.mjs` | exercised by hand: CSP/nosniff present, gzip, ETag/304, 404, 405, traversal blocked, `.mjs` typed `text/javascript` |
| `nginx.conf` | **still not syntax-checked - nginx is not installed here.** Brace-balanced and reviewed only. Run `nginx -t` before reloading |
| Docker image | **daemon unreachable where this was written; the image has never been built** |
| API routes | every one exercised against the production build before they were deleted; the deletion is covered by the export assertions above |
| Node version | **mismatch: developed on Node 26, image defaults to Node 22** |

Next 16 requires `>=20.9.0` so Node 22 is valid, and nothing here uses a
Node-26-only API - but "validated on X, deployed on Y" is the gap that hid two
real bugs. If you can test on 22, prefer 22 LTS; otherwise build with
`--build-arg NODE_VERSION=26-alpine` to deploy what was tested.

## Operational notes

- **Attribution is a licence obligation, not decoration.** OpenTopoMap is
  CC-BY-SA, Carto's fonts and Esri's imagery have their own terms, and
  `verify:basemap` asserts that the attribution control follows the basemap.
- **Open-Meteo's free tier is NON-COMMERCIAL.** Subscriptions or advertising
  both count. Weather is fetched by each visitor's browser, so your server
  never pays for it - but the obligation is on the use, not the transport.
- **The on-hold feeds stay on hold** until a data-use agreement exists. See
  `SERVER_SIDE_FEEDS` in `src/lib/feeds/index.ts`. Do not re-enable them to
  silence a badge: a feed that is off and says why beats one that is on and
  lying.
- **CelesTrak** is public domain and re-read every 6 hours by each visitor's
  browser; no credentials, no rotation.
- **If you add a live feed later**, you are re-introducing a server. Update
  `scripts/static-headers.mjs` (`connect-src`) in the same change, or the CSP
  will block it and the failure will look like an app bug.
