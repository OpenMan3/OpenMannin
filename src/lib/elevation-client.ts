/**
 * Browser half of the elevation profile: fetch and decode DEM tiles.
 *
 * The pure arithmetic - terrarium decoding, tile addressing, even resampling -
 * lives in src/lib/elevation.ts. This module does the parts that need the DOM:
 * fetching the PNG tiles from the keyless AWS DEM, decoding their pixels on a
 * canvas, and sampling the grid along the route.
 *
 * ONLINE-ONLY BY DESIGN. The profile is a convenience, not part of navigation,
 * so it never falls back to a cached or invented height: offline, the caller is
 * told and shows nothing. Decoded tiles are memoised in a small bounded cache
 * so panning a route back and forth does not re-download the same square.
 */

import { TERRAIN_TILES } from "./map-style.ts";
import {
  decodeTerrarium,
  lonLatToTileFloat,
  sampleGridBilinear,
  sampleLine,
  type ElevationPoint,
} from "./elevation.ts";

const DEM_ZOOM = 12;
const TILE = 256;
/** Roughly a 3x3 block around an island route; enough to avoid re-fetch churn. */
const MAX_CACHED_TILES = 24;

/** Decoded elevations for one tile, row-major, `TILE * TILE` long. */
type TileGrid = Float32Array;

const tileCache = new Map<string, TileGrid>();

function remember(key: string, grid: TileGrid): void {
  tileCache.set(key, grid);
  // Map preserves insertion order; drop the oldest once past the cap.
  while (tileCache.size > MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
}

/** A 2D canvas that works in a worker (OffscreenCanvas) or on the main thread. */
function makeCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") {
    try {
      return new OffscreenCanvas(TILE, TILE);
    } catch {
      /* fall through to the DOM canvas */
    }
  }
  if (typeof document !== "undefined") {
    const cv = document.createElement("canvas");
    cv.width = TILE;
    cv.height = TILE;
    return cv;
  }
  return null;
}

function tileUrl(z: number, x: number, y: number): string {
  return TERRAIN_TILES[0]
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Fetch, decode and memoise a DEM tile. Returns null when it cannot be read. */
async function loadTile(
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<TileGrid | null> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached) return cached;

  if (typeof createImageBitmap !== "function") return null;
  const canvas = makeCanvas();
  if (!canvas) return null;

  const res = await fetch(tileUrl(z, x, y), { signal });
  if (!res.ok) return null;
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) {
    bitmap.close?.();
    return null;
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, TILE, TILE);
  bitmap.close?.();

  const grid = new Float32Array(TILE * TILE);
  for (let i = 0, p = 0; i < grid.length; i++, p += 4) {
    grid[i] = decodeTerrarium(data[p], data[p + 1], data[p + 2]);
  }
  remember(key, grid);
  return grid;
}

export interface FetchProfileOptions {
  signal?: AbortSignal;
  maxSamples?: number;
  zoom?: number;
}

/**
 * Sample the DEM along a route. Throws when offline or when a needed tile
 * cannot be read, so the caller can distinguish "no profile" from a flat one.
 */
export async function fetchElevationProfile(
  coords: readonly [number, number][],
  opts: FetchProfileOptions = {},
): Promise<ElevationPoint[]> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("offline");
  }
  const zoom = opts.zoom ?? DEM_ZOOM;
  const samples = sampleLine(coords, opts.maxSamples ?? 120);
  const out: ElevationPoint[] = [];
  for (const s of samples) {
    const { x, y } = lonLatToTileFloat(s.lon, s.lat, zoom);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const grid = await loadTile(zoom, tx, ty, opts.signal);
    if (!grid) throw new Error("dem tile unavailable");
    out.push({ distM: s.distM, eleM: sampleGridBilinear(grid, TILE, x - tx, y - ty) });
  }
  return out;
}

/** Test seam: clear the tile memo (not used by the app). */
export function _clearTileCache(): void {
  tileCache.clear();
}
