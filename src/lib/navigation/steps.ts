/**
 * Turn-by-turn steps derived from route geometry.
 *
 * The routing worker returns a bare polyline - the graph has no street names
 * and no junction tags, so nothing here is invented as a ground truth. What the
 * polyline DOES contain is honest navigational information: where the bearing
 * changes enough to be a "turn", and how far you travel between turns. This
 * module turns that into a short, readable list of legs.
 *
 * PURE: no DOM, no MapLibre, no fetch - testable under `node --test`.
 */

export interface NavigationStep {
  /** e.g. "Head north for 300 m" (first leg) or "Turn right, then 1.2 km". */
  instruction: string;
  /** Length of this leg in metres. */
  distanceM: number;
  /** Absolute compass bearing of the leg's travel direction, degrees 0-360. */
  bearing: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Normalise a compass bearing into [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest angle from `a` to `b`, in degrees, within (-180, 180]. */
export function bearingDelta(a: number, b: number): number {
  const d = ((normalizeDeg(b - a) + 180 + 360) % 360) - 180;
  // A dead reversal is +180, not -180, so callers can rely on the sign.
  return d === -180 ? 180 : d;
}

/** Initial great-circle bearing between two lon/lat points, degrees 0-360. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return normalizeDeg(Math.atan2(y, x) * DEG);
}

/** Great-circle distance between two lon/lat points, metres. */
export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = (lat2 - lat1) * RAD;
  const dl = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * 6_371_008.8 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const CARDINALS = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];

/** 16-point compass name for a bearing. */
export function cardinal(deg: number): string {
  return CARDINALS[Math.round(normalizeDeg(deg) / 45) % 8];
}

const TURN_THRESHOLD_DEG = 30;
/** Never show more legs than this; extra distance folds into the last leg. */
const MAX_LEGS = 16;
/** A leg this short contributes no distance and is dropped. */
const MIN_LEG_M = 8;

export function formatStepDistance(m: number): string {
  if (m >= 1000) {
    const km = m / 1000;
    return `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${Math.round(m)} m`;
}

function turnPhrase(fromBearing: number, toBearing: number): string {
  const d = bearingDelta(fromBearing, toBearing);
  const abs = Math.abs(d);
  if (abs < 20) return "Continue";
  const side = d > 0 ? "right" : "left";
  if (abs >= 135) return `Turn sharp ${side}`;
  if (abs >= 60) return `Turn ${side}`;
  if (abs >= 20) return `Bear ${side}`;
  return "Continue";
}

/**
 * Split a route polyline into straight-ish legs. Segments whose bearing stays
 * near the leg's running direction accumulate; a change past
 * TURN_THRESHOLD_DEG closes the leg and starts the next.
 */
export function deriveSteps(coordinates: readonly (readonly [number, number])[]): NavigationStep[] {
  if (coordinates.length < 2) return [];

  const segs: { bearing: number; distanceM: number }[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    const [x1, y1] = coordinates[i - 1];
    const [x2, y2] = coordinates[i];
    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
    const d = haversineM(x1, y1, x2, y2);
    if (d < 0.5) continue;
    segs.push({ bearing: bearingDeg(x1, y1, x2, y2), distanceM: d });
  }
  if (segs.length === 0) return [];

  // Walk the segments, folding each into the current leg while its bearing
  // stays near the leg's running (mean) direction.
  const legs: { bearing: number; distanceM: number }[] = [];
  let sumX = 0;
  let sumY = 0;
  let distanceM = 0;

  const closeLeg = () => {
    const bearing = normalizeDeg(Math.atan2(sumY, sumX) * DEG);
    if (distanceM >= MIN_LEG_M) legs.push({ bearing, distanceM });
  };

  let prevBearing = segs[0].bearing;
  for (const seg of segs) {
    const deltaFromPrev = Math.abs(bearingDelta(prevBearing, seg.bearing));
    const deltaFromRun = Math.abs(bearingDelta(normalizeDeg(Math.atan2(sumY, sumX) * DEG), seg.bearing));
    // Wide swing on a single segment that also swings against our direction:
    // start a new leg. Without it, two S-bends fold into one misleading leg.
    if (legs.length > 0 || distanceM > 0) {
      if (deltaFromPrev > TURN_THRESHOLD_DEG && deltaFromRun > TURN_THRESHOLD_DEG * 1.4) {
        closeLeg();
        sumX = 0;
        sumY = 0;
        distanceM = 0;
      }
    }
    const b = seg.bearing * RAD;
    sumX += Math.cos(b);
    sumY += Math.sin(b);
    distanceM += seg.distanceM;
    prevBearing = seg.bearing;
  }
  closeLeg();

  if (legs.length === 0) {
    // Everything folded into one leg (e.g. a single straight connector).
    const total = segs.reduce((n, s) => n + s.distanceM, 0);
    return [{ bearing: segs[0].bearing, distanceM: total, instruction: "" }];
  }

  // Fold the (rare) tail of loose segments into the final leg.
  const folded = legs.slice(0, MAX_LEGS);
  if (legs.length > MAX_LEGS) {
    const rest = legs.slice(MAX_LEGS - 1);
    folded[folded.length - 1] = {
      bearing: folded[folded.length - 1].bearing,
      distanceM: folded[folded.length - 1].distanceM + rest.reduce((n, l) => n + l.distanceM, 0),
    };
  }

  return folded.map((leg, i) => ({
    instruction:
      i === 0
        ? `Head ${cardinal(leg.bearing)} for ${formatStepDistance(leg.distanceM)}`
        : `${turnPhrase(folded[i - 1].bearing, leg.bearing)}, heading ${cardinal(leg.bearing)} for ${formatStepDistance(leg.distanceM)}`,
    distanceM: Math.round(leg.distanceM),
    bearing: Math.round(leg.bearing),
  }));
}