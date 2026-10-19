/**
 * Elevation-profile maths.
 *
 * The route's height profile is read from the same keyless DEM the 3D terrain
 * uses (AWS Terrain Tiles, terrarium encoding; see map-style.ts). Decoding a
 * terrarium pixel and resampling a polyline are pure arithmetic, so they live
 * here and run under `node --test`; the tile fetching and PNG decoding are the
 * browser half (elevation-client.ts).
 *
 * Terrarium encodes metres across the RGB channels as
 * `(R * 256 + G + B / 256) - 32768`, which is why a tile must be decoded rather
 * than read as luminance.
 */

import { haversineM } from "./measure.ts";

/** One point of a terrain-sampled route: where it is and how far along. */
export interface ElevationSample {
  lon: number;
  lat: number;
  /** Distance from the start of the line, metres. */
  distM: number;
}

/** A decoded profile point: distance along the route and height above sea level. */
export interface ElevationPoint {
  distM: number;
  eleM: number;
}

/** Summary numbers for the profile's caption. */
export interface ProfileStats {
  minM: number;
  maxM: number;
  ascentM: number;
  descentM: number;
}

/** Decode one terrarium pixel to metres. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Number of tiles per axis at a zoom level. */
export function tilesPerAxis(z: number): number {
  return 2 ** z;
}

/**
 * Fractional slippy-map tile coordinates for a point: the integer part is the
 * tile, the fraction is the position within it (0..1). Standard Web Mercator.
 */
export function lonLatToTileFloat(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = tilesPerAxis(z);
  const latRad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * Resample a lon/lat polyline into at most `maxSamples` points spaced evenly by
 * distance. Even spacing (rather than one sample per vertex) keeps the DEM
 * fetch bounded however many vertices the router returned, and makes the chart
 * honest about distance. A zero-length line yields a single point.
 */
export function sampleLine(
  coords: readonly [number, number][],
  maxSamples = 120,
): ElevationSample[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) {
    return [{ lon: coords[0][0], lat: coords[0][1], distM: 0 }];
  }

  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(
      cum[i - 1] +
        haversineM(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]),
    );
  }
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.min(maxSamples, coords.length));
  const out: ElevationSample[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = total === 0 ? 0 : (i / (n - 1)) * total;
    while (seg < coords.length - 2 && cum[seg + 1] < target) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (target - cum[seg]) / segLen : 0;
    out.push({
      lon: coords[seg][0] + (coords[seg + 1][0] - coords[seg][0]) * t,
      lat: coords[seg][1] + (coords[seg + 1][1] - coords[seg][1]) * t,
      distM: target,
    });
  }
  return out;
}

/** Min/max height and total climb/descent over a decoded profile. */
export function profileStats(points: readonly ElevationPoint[]): ProfileStats {
  if (points.length === 0) return { minM: 0, maxM: 0, ascentM: 0, descentM: 0 };
  let minM = Infinity;
  let maxM = -Infinity;
  let ascentM = 0;
  let descentM = 0;
  for (let i = 0; i < points.length; i++) {
    const e = points[i].eleM;
    if (e < minM) minM = e;
    if (e > maxM) maxM = e;
    if (i > 0) {
      const d = e - points[i - 1].eleM;
      if (d > 0) ascentM += d;
      else descentM -= d;
    }
  }
  return { minM, maxM, ascentM, descentM };
}
