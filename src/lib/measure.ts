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
 * The bearing of the final segment is computed using atan2.
 */

export type MeasurePoint = { lon: number; lat: number };

export interface MeasureSummary {
  totalM: number;
  segmentsM: number[];
  areaM2: number | null;
  bearingDeg: number | null;
  pointCount: number;
}

export interface MeasureState {
  readonly points: MeasurePoint[];
  readonly pointCount: number;
  add: (lon: number, lat: number) => void;
  undo: () => MeasurePoint | null;
  clear: () => void;
  summary: () => MeasureSummary;
}

const R = 6371e3;
const TO_RAD = Math.PI / 180;

/** Project a point to local metres using a reference latitude. */
function toMetres(point: MeasurePoint, refLat: number): { x: number; y: number } {
  return {
    x: point.lon * TO_RAD * R * Math.cos(refLat * TO_RAD),
    y: point.lat * TO_RAD * R,
  };
}

/** Create a fresh measure state. */
export function createMeasureState(): MeasureState {
  const points: MeasurePoint[] = [];

  const add = (lon: number, lat: number) => {
    points.push({ lon, lat });
  };

  const undo = () => points.pop() ?? null;

  const clear = () => {
    points.length = 0;
  };

  return {
    points,
    get pointCount() {
      return points.length;
    },
    add,
    undo,
    clear,
    summary: () => summarizeMeasure(points),
  };
}

/**
 * Summarise a point list: total and per-segment distance, enclosed area (with
 * 3+ points) and the bearing of the final segment.
 *
 * Kept separate from `createMeasureState` so a React layer holding its own
 * immutable point array can summarise it without re-deriving the maths (or
 * calling into the mutable state machine just to read a number).
 */
export function summarizeMeasure(points: MeasurePoint[]): MeasureSummary {
  const p = points.length;

  let totalM = 0;
  const segmentsM: number[] = [];
  for (let i = 0; i < p - 1; i++) {
    const d = haversineM(points[i].lon, points[i].lat, points[i + 1].lon, points[i + 1].lat);
    totalM += d;
    segmentsM.push(d);
  }

  let areaM2: number | null = null;
  if (p >= 3) {
    const refLat = points.reduce((sum, pt) => sum + pt.lat, 0) / p;
    let acc = 0;
    for (let i = 0; i < p; i++) {
      const a = toMetres(points[i], refLat);
      const b = toMetres(points[(i + 1) % p], refLat);
      acc += a.x * b.y - b.x * a.y;
    }
    areaM2 = Math.abs(acc) / 2;
  }

  let bearingDeg: number | null = null;
  if (p >= 2) {
    const a = points[p - 2];
    const b = points[p - 1];
    const deg = (Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180) / Math.PI;
    bearingDeg = (deg + 360) % 360;
  }

  return { totalM, segmentsM, areaM2, bearingDeg, pointCount: p };
}

/** haversine distance in metres between two WGS-84 points. */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const φ1 = lat1 * TO_RAD;
  const φ2 = lat2 * TO_RAD;
  const Δφ = (lat2 - lat1) * TO_RAD;
  const Δλ = (lon2 - lon1) * TO_RAD;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
