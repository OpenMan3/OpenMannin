/**
 * Measurement tool for the OpenMannin map app.
 *
 * WHY THIS EXISTS
 * ---------------
 * Users need to measure distances, areas, and track points on the map.
 * This module provides the state machine and maths for that, without
 * requiring a DOM (so the tests run in Node).
 *
 * POINT COLLECTION
 * ---------------
 * Points are added by map clicks when measure mode is active.
 * Undo removes the last point; clear removes all points.
 * The last two points define a segment; the full polyline is formed
 * by connecting them in order.
 *
 * AREA COMPUTATION
 * ---------------
 * When ≥3 points are collected, the area is computed via the planar
 * shoelace formula on equirectangular-projected coordinates (sufficient
 * for the small Isle of Man area). The result is in square metres.
 *
 * BEARING
 * --------
 * The bearing from the last point to the cursor is computed using atan2.
 */

export type MeasurePoint = { lon: number; lat: number };

/** Create a fresh measure state. */
export function createMeasureState(): {
  points: MeasurePoint[];
  add: (lon: number, lat: number) => void;
  undo: () => MeasurePoint | null;
  clear: () => void;
  summary: {
    totalM: number;
    segmentsM: number[];
    areaM2: number | null;
    bearingDeg: number | null;
    pointCount: number;
  };
} {
  const points: MeasurePoint[] = [];
  const add = (lon: number, lat: number) => {
    points.push({ lon, lat });
  };
  const undo = () => {
    if (points.length === 0) return null;
    const last = points.pop();
    return last;
  };
  const clear = () => {
    points.length = 0;
  };
  const summary = (): {
    totalM: number;
    segmentsM: number[];
    areaM2: number | null;
    bearingDeg: number | null;
    pointCount: number;
  } => {
    const p = points.length;
    let total = 0;
    const segs: number[] = [];
    for (let i = 0; i < p - 1; i++) {
      const d = haversineM(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat);
      total += d;
      segs.push(d);
    }
    let area: number | null = null;
    if (p >= 3) {
      // planar shoelace on equirectangular proj
      let x1 = 0,
        y1 = 0;
      for (let i = 0; i < p; i++) {
        const lon = points[i].lon, lat = points[i].lat;
        const x = lon * Math.cos((points[(i + 1) % p].lat + points[i].lat) / 2);
        const y = lat;
        x1 += x * y;
        y1 += y * x;
      }
      area = Math.abs(x1 - y1) / 2; // m² approx (scale: rough for IoM)
    }
    const lastBearing =
      p >= 2
        ? (() => {
            const a = points[p - 2];
            const b = points[p - 1];
            return (Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180) / Math.PI;
          })()
        : null;
    return {
      totalM: total,
      segmentsM: segs,
      areaM2: area,
      bearingDeg: bearingDeg,
      pointCount: p,
    };
  };
  return { points, add, undo, clear, summary };
}

/** haversine distance in metres between two WGS-84 points. */
function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}