/**
 * Routing profiles: how walking and driving traverse the road network.
 *
 * The graph (src/lib/navigation/graph.ts) is profile-agnostic: it is a plain
 * topology with a per-edge OSM `highway` class. A profile turns that into a
 * cost - kilometres per hour, and which classes are traversable at all. A
 * walker can step down a footpath a car cannot use; a car that tries to route
 * along a footpath stops at the first alley.
 *
 * Speeds are deliberately conservative and match the island's reality (no
 * motorway network; national speed limit 60 mph, urban 30). They are rounded
 * figures for planning, not a live ETA promise.
 */

export type RouteMode = "driving" | "walking";

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

const DRIVING: Profile = {
  id: "driving",
  label: "Drive",
  defaultSpeedKmh: 40,
  maxSnapM: 300,
  speedKmh: DRIVING_SPEEDS,
};

/**
 * Walking is one speed flat - the network classes matter only for who is
 * allowed on them. Motorway and trunk are excluded (pedestrians are not), and
 * everything a pedestrian can reasonably use gets 4.8 km/h.
 */
const WALKING: Profile = {
  id: "walking",
  label: "Walk",
  defaultSpeedKmh: 4.8,
  maxSnapM: 150,
  speedKmh: {},
};

/** Speed a profile assigns an edge, km/h, or null when the class is forbidden. */
export function edgeSpeed(profile: Profile, highway: string | null | undefined): number | null {
  if (profile.id === "driving") {
    if (NOT_DRIVABLE.has(highway ?? "")) return null;
    return profile.speedKmh[highway ?? ""] ?? DRIVING.defaultSpeedKmh;
  }
  // Walking.
  if (highway === "motorway" || highway === "trunk" || highway === "raceway" || highway === "ferry") {
    return null;
  }
  return WALKING.defaultSpeedKmh;
}

/** Time in seconds to traverse `lengthM` metres at the profile's speed. */
export function edgeTimeS(profile: Profile, lengthM: number, highway: string | null | undefined): number | null {
  const speed = edgeSpeed(profile, highway);
  if (speed === null) return null;
  // m -> km -> h -> s: /1000 / speed * 3600.
  return (lengthM / speed) * 3.6;
}

/** The fastest any edge in this profile can be, for the A* heuristic lower bound. */
export function maxSpeedKmh(profile: Profile): number {
  if (profile.id === "walking") return WALKING.defaultSpeedKmh;
  return Math.max(DRIVING.defaultSpeedKmh, ...Object.values(DRIVING.speedKmh));
}

export const PROFILES: Record<RouteMode, Profile> = {
  driving: DRIVING,
  walking: WALKING,
};

export const ROUTE_MODES: RouteMode[] = ["driving", "walking"];