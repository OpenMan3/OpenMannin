import { NextResponse } from "next/server";

/**
 * Server-side tile proxy for OpenTopoMap.
 *
 * WHY THIS EXISTS. OpenTopoMap's tile servers send no
 * `Access-Control-Allow-Origin` header, so a browser refuses them outright:
 *
 *   Cross-Origin Request Blocked: The Same Origin Policy disallows reading the
 *   remote resource at https://b.tile.opentopomap.org/18/127791/83962.png.
 *   (Reason: CORS header 'Access-Control-Allow-Origin' missing)
 *
 * There is no header the client can set to fix that, and MapLibre loads raster
 * tiles directly, so the only way to get real topographic detail onto the map is
 * to fetch it here and re-serve it same-origin. The browser then sees a request
 * to /api/tiles/opentopo/... with no cross-origin involved at all.
 *
 * Deliberately NOT a general-purpose proxy. The upstream is a fixed constant
 * chosen from a small allowlist, and z/x/y are validated as integers in range,
 * so this cannot be pointed at an arbitrary host. An open proxy on a public
 * route is an SSRF and abuse magnet; this is a tile fetcher for one known
 * basemap.
 *
 * ATTRIBUTION IS NOT OPTIONAL. OpenTopoMap is CC-BY-SA: map data © OpenStreetMap
 * contributors, SRTM, and the style is © OpenTopoMap. Both are surfaced in the
 * map's attribution control and recorded in src/lib/sources.ts.
 */

export const runtime = "nodejs";

const UPSTREAMS = [
  "https://a.tile.opentopomap.org",
  "https://b.tile.opentopomap.org",
];

const MAX_ZOOM = 17;

/**
 * Coerce a path segment to a non-negative integer, or null.
 *
 * Up to 7 digits is generous: this basemap stops at z17, where the largest
 * index is 2^17 = 131072. Anything longer is either a mistake or an attempt to
 * push something unexpected through the URL.
 */
function intOrNull(v: string): number | null {
  if (!/^\d{1,7}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ z: string; x: string; y: string }> },
) {
  const { z: zs, x: xs, y: ys } = await ctx.params;

  const z = intOrNull(zs);
  const x = intOrNull(xs);
  const y = intOrNull(ys);

  // Reject rather than clamp: a clamped tile silently renders the wrong place,
  // which is far worse on a map than a missing one.
  if (z === null || x === null || y === null || z > MAX_ZOOM) {
    return NextResponse.json({ error: "bad tile coordinates" }, { status: 400 });
  }
  const limit = 2 ** z;
  if (x >= limit || y >= limit) {
    return NextResponse.json({ error: "tile out of range for zoom" }, { status: 400 });
  }

  // Try each subdomain so one failing node does not blank the basemap.
  let lastStatus = 502;
  let lastBody: ArrayBuffer | null = null;

  for (const base of UPSTREAMS) {
    try {
      const res = await fetch(`${base}/${z}/${x}/${y}.png`, {
        // Tiles are immutable per coordinate, so cache hard at the edge.
        next: { revalidate: 60 * 60 * 24 * 7 },
        headers: { "User-Agent": "OpenMannin/0.1 (open-source Isle of Man map)" },
      });
      if (!res.ok) {
        lastStatus = res.status === 404 ? 404 : 502;
        continue;
      }
      const body = await res.arrayBuffer();
      lastBody = body;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=604800, immutable",
          // Same-origin, but set explicitly so a future CDN cannot reintroduce
          // the exact problem this route exists to solve.
          "Access-Control-Allow-Origin": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      continue;
    }
  }

  return NextResponse.json(
    { error: "upstream tile unavailable", status: lastStatus },
    { status: lastStatus },
  );
}