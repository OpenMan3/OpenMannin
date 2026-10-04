# Deploying OpenMannin

## Read this first: two things rule out most hosts

**1. This is not a static site.** Three routes are live server code:

| Route | Why it needs a server |
|---|---|
| `/api/passes` | SGP4 propagation of TLEs, server-side |
| `/api/tiles/opentopo/*` | Proxies OpenTopoMap, which sends no CORS header |
| `/api/marine` | Holds one upstream AIS socket and fans it out |

Deploy the static output to Netlify, GitHub Pages or Cloudflare Pages and you get
a basemap with **no data layers and three broken endpoints**. `next build`
happily produces an artefact that looks static, so this fails quietly.

**2. There is no data in git.** `public/data/*.geojson` is gitignored — every
`npm run ingest:all` rewrites all 38 layers, which would be ~10 MB of diff
churn per run. A fresh clone contains **zero map data**. Whatever you deploy
must run the ingest step, or bake the data in.

## Requirements

- **Node 22+** (uses `node:sqlite`-era deps and Next 16)
- A **Node-capable host**: Docker, Fly.io, Railway, Render, a VPS, or Vercel
- Outbound internet access at runtime for CelesTrak, OpenTopoMap and (if
  enabled) AISStream

## Option A: Docker (recommended)

The only option that satisfies both constraints and gives you a long-lived
process, which matters because the AIS route holds a WebSocket that serverless
function limits tend to kill.

```bash
# Build (runs ingest inside the image — needs network access)
docker build -t openmannin .

# Run
docker run -p 3000:3000 openmannin

# Or with compose
docker compose up -d
```

Then check it actually came up with data:

```bash
curl -s localhost:3000/api/health | python3 -m json.tool
```

`"ok": true` requires the MapLibre worker to be present and every registered
layer to have data. A deploy missing either returns 503 rather than looking
fine.

> **The image build is untested.** The Docker daemon was not reachable in the
> environment where this was written, so treat the first build as unverified.
> The likeliest failure is the ingest step, not the Docker syntax.

### Ingest is the fragile step

The ingest scripts call third-party APIs and several rate-limit or time out.
Overpass in particular returned 504s repeatedly during development. The build
fails loudly rather than shipping an empty map — that is deliberate, but it
means a build can fail for reasons that have nothing to do with your code.

If you need builds that cannot be broken by someone else's outage, bake the
data in once:

```bash
# Populate data locally, then build with ingest disabled.
npm run ingest:all
docker build --build-arg SKIP_INGEST=1 -t openmannin .
# The Dockerfile refuses to build with SKIP_INGEST=1 if public/data is empty.
```

## Option B: Fly.io

`fly.toml` is committed and validated (parses as TOML, health check path and
machine settings confirmed).

```bash
fly launch --no-deploy      # first time only, to create the app
fly deploy
fly secrets set AISSTREAM_API_KEY=...   # only once you have permission
fly curl localhost:3000/api/health
```

Two deliberate settings: `auto_stop_machines = "off"` with
`min_machines_running = 1`, because a cold start means the MapLibre worker and
the CelesTrak TLE fetch both happen on the first request and there is no cache in
front of the tile proxy; and the health check wired to `/api/health`, so a
deploy that comes up without its worker or data is pulled from rotation instead
of serving a blank island.

## Option C: Vercel

Works for the map, the tile proxy and satellite passes. **AIS will not** —
serverless functions are not a good home for a persistent upstream WebSocket.

Two things to handle:

- **Vercel does not run the Docker ingest.** Either commit the data (remove the
  `public/data/` block from `.gitignore`, accepting the licence decision that
  implies) or add a build step that runs `npm run ingest:all`.
- `/api/tiles/opentopo` proxies tiles outbound on every basemap switch. That is
  bandwidth on your account, and it is the shape of thing a platform may rate
  limit.

## Option D: Plain VPS

`deploy/openmannin.service` (systemd) and `deploy/nginx.conf` are committed.

```bash
sudo useradd --system --home /opt/openmannin --shell /usr/sbin/nologin openmannin
sudo -u openmannin git clone <repo> /opt/openmannin
cd /opt/openmannin
sudo -u openmannin npm ci
sudo -u openmannin npm run ingest:all      # no map data is committed
sudo -u openmannin npm run build

sudo cp deploy/openmannin.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now openmannin

sudo cp deploy/nginx.conf /etc/nginx/sites-available/openmannin
sudo ln -s /etc/nginx/sites-available/openmannin /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The systemd unit passes `systemd-analyze verify`. That check earned its keep: it
caught a hardcoded `ExecStart=/usr/bin/npm`, which would have left the service
permanently dead on any machine where npm is not at `/usr/bin` - a mise, asdf or
nvm install, or a tarball install. It now resolves node via `env` with a pinned
PATH and an overridable `EnvironmentFile`. Verify it on your target host:

```bash
systemd-analyze verify /etc/systemd/system/openmannin.service
```

nginx needs this in the `http {}` block of your main `nginx.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

The nginx config is written but **not syntax-checked** - nginx is not installed
in the environment where it was written. Run `nginx -t` before reloading.

Two things the nginx config deliberately gets right, because getting either
wrong reproduces a bug already seen during development:

- `/maplibre-gl-worker.mjs` is forced to `application/javascript`. If a proxy
  serves it as `text/html`, the browser refuses it and **every data layer
  silently disappears** while the basemap keeps drawing.
- `/api/marine` is **not** cached. It is a live vessel feed; caching it would
  present stale positions as current.

## What is verified, and what is not

Honest accounting, because two of these gaps produced real bugs already.

| Checked | How |
|---|---|
| `fly.toml` | parses as TOML; health path and machine settings read back |
| `openmannin.service` | `systemd-analyze verify` passes clean |
| `nginx.conf` | braces balanced and reviewed — **nginx not installed, so not syntax-checked** |
| `docker-compose.yml` | parses as YAML |
| `Dockerfile` | instructions and ARG wiring reviewed — **daemon unreachable, so the image was never built** |
| Node version | **mismatch: validated on Node 26, image defaults to Node 22** |

On that last row: Next 16 requires `>=20.9.0` so Node 22 is valid, and nothing
here uses a Node-26-only API. But "validated on X, deployed on Y" is exactly
the gap that hid the MapLibre worker bug and the attribution bug. The Dockerfile
takes a build arg so you can pin what you actually tested:

```bash
docker build --build-arg NODE_VERSION=26-alpine -t openmannin .
```

If you can test on 22, prefer 22 LTS for production.

## Verifying a deploy

```bash
curl -s https://your-host/api/health | python3 -m json.tool
```

Check, in order:

1. `"worker": true` — otherwise every data layer is invisible while the
   basemap still draws. This is the failure that cost the most time so far.
2. `"absent": []` — no registered layer without data
3. `"features"` — a plausible number (currently ~38,400). A small number means
   ingest partially failed and you will get a half-empty island.
4. `warnings` — expected to list AIS and aircraft until you have permission.
   Those are informational; the map is correct without them.

Then load the page and confirm the attribution credits whoever served the
basemap you selected. It should change with the basemap.

## Operational notes

- **Secrets.** `AISSTREAM_API_KEY` is the only one the code reads. Do not set it
  until you have AISStream's permission — the route is gated precisely so that
  setting it is a deliberate assertion that permission exists.
- **Tile proxy bandwidth.** Each basemap switch pulls ~20 tiles through your
  server. Cached for a week client-side, so steady-state cost is low, but a
  cold cache on a popular page is not.
- **CelesTrak** is re-read every 6 hours and is public domain, so pass
  predictions need no credentials and no secret rotation.
- **Attribution is a licence obligation, not decoration.** OpenTopoMap is
  CC-BY-SA and Esri's basemap terms are the least certain in the project. The
  attribution control updates with the basemap and `verify:basemap` asserts it.