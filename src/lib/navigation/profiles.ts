/**
 * Routing profiles: how walking, cycling and driving traverse the road network.
 *
 * The graph (src/lib/navigation/graph.ts) is profile-agnostic: it is a plain
 * topology plus, per edge, the raw OpenStreetMap tags that decide access
 * (`oneway`, `access`, `motor_vehicle`, `foot`, `bicycle`, `maxspeed`, ...).
 * A profile turns that into a cost - kilometres per hour, which classes are
 * traversable at all, and which direction a one-way may be taken. A walker can
 * step down a footpath a car cannot use; a cyclist may push along a bridleway
 * a car would not dream of; a car that tries to route the wrong way up a
 * one-way is refused.
 *
 * Speeds are deliberately conservative and match the island's reality (no
 * motorway network; national speed limit 60 mph, urban 20-30). Where OSM
 * carries a posted `maxspeed`, it caps the class speed rather than replacing
 * it, so a residential road tagged 30 mph is not driven at 80. They remain
 * rounded figures for planning, not a live ETA promise.
 */

export type RouteMode = "driving" | "walking" | "cycling";

/**
 * The OpenStreetMap tags on a road segment that decide who may use it and how
 * fast. Every field is `null` when the tag is absent, so the profile layer sees
 * an honest "untagged" rather than a guessed default.
 */
export interface RoadTags {
  name: string | null;
  /** 0 = two-way, 1 = forward (the way's own direction), -1 = reverse only. */
  oneway: -1 | 0 | 1;
  access: string | null;
  motorVehicle: string | null;
  motorcar: string | null;
  vehicle: string | null;
  foot: string | null;
  bicycle: string | null;
  service: string | null;
  maxspeed: string | null;
}

export interface Profile {
  id: RouteMode;
  label: string;
  /** Planning speed for unknown/unmapped highway classes. */
  defaultSpeedKmh: number;
  /** Beyond this a point is "not on the network" and gets no route. */
  maxSnapM: number;
  /** speed in km/h per OSM highway class, for the classes this mode uses. */
  speedKmh: Readonly<Record<string, number>>;
}

const DRIVING_SPEEDS: Record<string, number> = {
  motorway: 100,
  trunk: 80,
  primary: 80,
  secondary: 80,
  tertiary: 60,
  unclassified: 50,
  residential: 40,
  living_street: 20,
  service: 20,
  track: 15,
  road: 40,
};

/**
 * Cycling is much flatter than driving: the class barely changes how fast a
 * person pedals. Surface and personal fitness dominate, so these are a small
 * band around 18 km/h rather than a spread from 15 to 100.
 */
const CYCLING_SPEEDS: Record<string, number> = {
  trunk: 18,
  primary: 18,
  secondary: 18,
  tertiary: 18,
  unclassified: 18,
  residential: 18,
  road: 18,
  living_street: 12,
  service: 12,
  track: 12,
  cycleway: 18,
  path: 12,
  bridleway: 12,
  footway: 8,
  pedestrian: 8,
};

const WALKING_KMH = 4.8;
/** Pushing a bike (bicycle=dismount) is no faster than walking. */
const DISMOUNT_KMH = 5;

/** Classes a car should not use under any circumstances. */
const NOT_DRIVABLE = new Set([
  "footway",
  "path",
  "steps",
  "cycleway",
  "bridleway",
  "pedestrian",
  "corridor",
  "bus_guideway",
  "construction",
  "proposed",
  "raceway",
  "ferry",
]);

/** Classes a bicycle may not use: motorways, steps and non-roads. */
const NOT_CYCLABLE = new Set([
  "motorway",
  "raceway",
  "steps",
  "corridor",
  "bus_guideway",
  "construction",
  "proposed",
  "ferry",
]);

/** Classes a pedestrian may not use (no footway by design). */
const NOT_WALKABLE = new Set(["motorway", "trunk", "raceway", "ferry", "construction", "proposed"]);

/**
 * Pavements: a bicycle is only allowed when the way explicitly permits it
 * (bicycle=yes/permissive/designated/dismount). Cycling on a pavement is not
 * assumed just because the way is mapped.
 */
const PAVEMENT = new Set(["footway", "pedestrian", "path", "platform"]);
const BICYCLE_PERMITS = new Set(["yes", "permissive", "designated", "dismount", "destination"]);

/** Access values that forbid a road to a category outright. */
const VEHICLE_DENY = new Set(["no", "private"]);
/** private roads are still walkable in the IoM's commons; access=no is not. */
const FOOT_DENY = new Set(["no"]);

const DRIVING: Profile = {
  id: "driving",
  label: "Drive",
  defaultSpeedKmh: 40,
  maxSnapM: 300,
  speedKmh: DRIVING_SPEEDS,
};

const WALKING: Profile = {
  id: "walking",
  label: "Walk",
  defaultSpeedKmh: WALKING_KMH,
  maxSnapM: 150,
  speedKmh: {},
};

const CYCLING: Profile = {
  id: "cycling",
  label: "Cycle",
  defaultSpeedKmh: 16,
  maxSnapM: 200,
  speedKmh: CYCLING_SPEEDS,
};

// ---- OSM tag interpretation -------------------------------------------------

function norm(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return t ? t : null;
}

/** The first non-empty tag in precedence order, lowercased, or null. */
function effectiveTag(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const n = norm(c);
    if (n) return n;
  }
  return null;
}

/**
 * A posted `maxspeed` as km/h, or null when the value is not a clean number
 * ("national", "NSL", "signals", "walk" and friends are left to the class
 * default rather than guessed at). A bare number is km/h, as OSM defines it;
 * an explicit "N mph" is converted.
 */
export function parseMaxspeedKmh(v: string | null | undefined): number | null {
  const s = norm(v);
  if (!s) return null;
  const mph = /^(\d+(?:\.\d+)?)\s*mph$/.exec(s);
  if (mph) {
    const n = Number(mph[1]) * 1.609344;
    return n > 0 ? n : null;
  }
  const kmh = /^(\d+(?:\.\d+)?)(?:\s*(?:km\/h|kmh|kph))?$/.exec(s);
  if (kmh) {
    const n = Number(kmh[1]);
    return n > 0 ? n : null;
  }
  return null;
}

/** True when a one-way edge may be traversed in the given direction. */
export function directionAllowed(tags: RoadTags | null, forward: boolean): boolean {
  const ow = tags?.oneway ?? 0;
  if (ow === 0) return true;
  return ow === 1 ? forward : !forward;
}

function drivingAllowed(highway: string | null | undefined, tags: RoadTags | null): boolean {
  if (NOT_DRIVABLE.has(highway ?? "")) return false;
  const tag = effectiveTag(tags?.motorcar, tags?.motorVehicle, tags?.vehicle, tags?.access);
  return !(tag && VEHICLE_DENY.has(tag));
}

function cyclingAllowed(highway: string | null | undefined, tags: RoadTags | null): boolean {
  const hw = highway ?? "";
  if (NOT_CYCLABLE.has(hw)) return false;
  const bike = norm(tags?.bicycle);
  if (PAVEMENT.has(hw) && !(bike && BICYCLE_PERMITS.has(bike))) return false;
  const tag = effectiveTag(tags?.bicycle, tags?.vehicle, tags?.access);
  return !(tag && VEHICLE_DENY.has(tag));
}

function walkingAllowed(highway: string | null | undefined, tags: RoadTags | null): boolean {
  if (NOT_WALKABLE.has(highway ?? "")) return false;
  const tag = effectiveTag(tags?.foot, tags?.access);
  return !(tag && FOOT_DENY.has(tag));
}

function cappedSpeed(base: number, tags: RoadTags | null): number {
  const limit = parseMaxspeedKmh(tags?.maxspeed);
  return limit !== null ? Math.min(base, limit) : base;
}

/** Speed a profile assigns an edge, km/h, or null when the class is forbidden. */
export function edgeSpeed(
  profile: Profile,
  highway: string | null | undefined,
  tags: RoadTags | null = null,
): number | null {
  if (profile.id === "walking") {
    return walkingAllowed(highway, tags) ? WALKING_KMH : null;
  }
  if (profile.id === "cycling") {
    if (!cyclingAllowed(highway, tags)) return null;
    if (norm(tags?.bicycle) === "dismount") return DISMOUNT_KMH;
    return cappedSpeed(CYCLING_SPEEDS[highway ?? ""] ?? CYCLING.defaultSpeedKmh, tags);
  }
  if (!drivingAllowed(highway, tags)) return null;
  return cappedSpeed(DRIVING_SPEEDS[highway ?? ""] ?? DRIVING.defaultSpeedKmh, tags);
}

/**
 * Time in seconds to traverse `lengthM` metres at the profile's speed, or null
 * when the profile may not make this move - either because the class is
 * forbidden or because it is the wrong way along a one-way.
 */
export function edgeTimeS(
  profile: Profile,
  lengthM: number,
  highway: string | null | undefined,
  tags: RoadTags | null = null,
  forward = true,
): number | null {
  const speed = edgeSpeed(profile, highway, tags);
  if (speed === null) return null;
  // Walkers ignore one-way restrictions; vehicles respect them.
  if (profile.id !== "walking" && !directionAllowed(tags, forward)) return null;
  // m -> km -> h -> s: /1000 / speed * 3600.
  return (lengthM / speed) * 3.6;
}

/** The fastest any edge in this profile can be, for the A* heuristic bound. */
export function maxSpeedKmh(profile: Profile): number {
  return Math.max(profile.defaultSpeedKmh, ...Object.values(profile.speedKmh));
}

export const PROFILES: Record<RouteMode, Profile> = {
  driving: DRIVING,
  walking: WALKING,
  cycling: CYCLING,
};

export const ROUTE_MODES: RouteMode[] = ["driving", "cycling", "walking"];
