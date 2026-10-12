/**
 * Navigation types, constants, and state helpers.
 *
 * Pure types and utilities - no side effects, no MapLibre dependencies.
 */

import type { NavigationStep } from "./steps";

export type RouteMode = "driving" | "walking" | "cycling";
export type FollowMode = "none" | "follow" | "heading";
export type LocationStatus = "idle" | "locating" | "active" | "error";
export type RouteStatus = "idle" | "loading" | "ready" | "no-route" | "error" | "recalculating" | "arrived";

export interface UserLocation {
  lon: number;
  lat: number;
  accuracyM?: number;
  heading?: number;
  timestamp: number;
}

export interface Destination {
  lon: number;
  lat: number;
  title: string;
  detail: string;
}

export interface NavigationState {
  locationStatus: LocationStatus;
  locationError: string | null;
  userLocation: UserLocation | null;
  destination: Destination | null;
  activeMode: RouteMode;
  routeStatus: RouteStatus;
  routeError: string | null;
  routes: Partial<Record<RouteMode, { distanceM: number; durationS: number } | null>>;
  /** Geometry-derived turn-by-turn legs for the active route. */
  steps: NavigationStep[];
  /** Live speed derived from successive GPS fixes, mph. null before two fixes. */
  speedMph: number | null;
  /** Posted speed limit of the road under the user, km/h. null when untagged. */
  speedLimitKmh: number | null;
  /** Index of the next unfinished turn-by-turn leg (0 = the current one). */
  stepIndex: number;
  /** Straight-line distance to the next maneuver, metres. */
  nextStepM: number;
  /**
   * True when live tracking is on but the user has dragged the map away from
   * their position, so the UI can surface a "Recenter" affordance. Cleared by
   * the locate press that flies back to the user.
   */
  recenterPending: boolean;
  /** Camera follow state: none = manual, follow = center on dot, heading = rotate to heading. */
  followMode: FollowMode;
  /** True when the user has deviated from the route and a recalc is pending. */
  offRoute: boolean;
  /** Distance along the route from the user's position (metres). */
  progressM: number;
  /** Distance remaining to destination (metres). */
  remainingM: number;
}

export type { Feature } from "../layer-data";

export interface Internal {
  locationStatus: LocationStatus;
  locationError: string | null;
  userLocation: UserLocation | null;
  destination: Destination | null;
  activeMode: RouteMode;
  routeStatus: RouteStatus;
  routeError: string | null;
  routes: Partial<Record<RouteMode, { distanceM: number; durationS: number } | null>>;
  steps: NavigationStep[];
  speedMph: number | null;
  /** Posted speed limit of the road under the user, km/h. null when untagged. */
  speedLimitKmh: number | null;
  stepIndex: number;
  nextStepM: number;
  lastSignature: string;
  firstFlyPending: boolean;
  routesFresh: boolean;
  fitPending: boolean;
  recenterPending: boolean;
  followMode: FollowMode;
  offRoute: boolean;
  progressM: number;
  remainingM: number;
  baseSteps: NavigationStep[];
  headingDeg: number | null;
}

export interface Destination {
  lon: number;
  lat: number;
  title: string;
  detail: string;
}

export interface AttachOptions {
  onState: (state: NavigationState) => void;
  /** MapView reads this to swallow the click that follows a long-press. */
  suppressClickUntil: { current: number };
}

export interface NavigationHost {
  dispose: () => void;
  /** Re-add markers/route after the style was swapped (basemap change). */
  rehydrate: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const LONG_PRESS_MS = 600;
export const MAX_DRIFT_PX = 12;
export const SNAP_RADIUS_PX = 15;
export const SUPPRESS_CLICK_MS = 700;

/** Orange pin colours (#f43f5e is the subsea-cable rose, kept for the pin). */
export const PIN_COLOR = "#f43f5e";
export const PIN_RING = "rgba(244, 63, 94, 0.22)";
export const DOT_COLOR = "#3b82f6";
export const DOT_HALO = "#60a5fa";
export const ACCURACY_FILL = "rgba(59, 130, 246, 0.12)";
export const ACCURACY_STROKE = "rgba(59, 130, 246, 0.35)";
export const ROUTE_COLOR = "#35c9d4";

/**
 * Layers whose features are worth snapping a long-press to. These carry a
 * human-readable name/address (house numbers, toponyms, bus stops, EV points,
 * heritage sites...). Road-centreline hits are deliberately excluded: dropping
 * a pin "on a road" shows the two addresses it joins, not the road.
 */
export const SNAP_LAYER_IDS = new Set([
  "house-numbers",
  "toponyms",
  "bus-stops",
  "ev",
  "traffic-signals",
  "postcodes",
  "heritage",
  "wifi",
  "comms-towers",
  "lighthouses",
  "satellite",
  "airport",
  "tide-stations",
  "ports",
  "cable-landings",
  "power",
  "reservoirs",
  "protected",
  "offshore-wind",
  "dumpsites",
]);

export const SOURCE_USER = "om-nav-user";
export const SOURCE_DEST = "om-nav-destination";
export const SOURCE_ROUTE = "om-nav-route";

export const ROUTE_LAYERS = [
  `${SOURCE_ROUTE}-casing`,
  `${SOURCE_ROUTE}-glow`,
  `${SOURCE_ROUTE}-main`,
];
export const USER_LAYERS = [
  `${SOURCE_USER}-accuracy`,
  `${SOURCE_USER}-halo`,
  `${SOURCE_USER}-dot`,
];
export const DEST_LAYERS = [`${SOURCE_DEST}-ring`, `${SOURCE_DEST}-pin`];

/** metres per pixel at lat = the island's mid-latitude, per zoom. */
export const ACCURACY_MULTIPLIERS: [number, number][] = [
  [8, 0.0028],
  [9, 0.0056],
  [10, 0.0112],
  [11, 0.0224],
  [13, 0.0894],
  [14, 0.1789],
  [15, 0.3577],
  [16, 0.7154],
  [17, 1.4308],
  [18, 2.8617],
  [19, 5.7233],
  [20, 11.4467],
];