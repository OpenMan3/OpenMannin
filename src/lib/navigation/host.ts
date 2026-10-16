/**
 * The map-side half of the navigation features.
 *
 * MapView owns the MapLibre instance and the style lifecycle; everything a
 * locate/drop-pin route touches on the map lives in here and is driven by a
 * single `attachNavigation(map, opts)` call. The UI peers (LocateButton,
 * DestinationSheet) stay dumb: they publish the current NavigationState via
 * window events and render whatever state they are handed.
 *
 * Three responsibilities, kept apart by function:
 *
 *  1. GPS. A navigator.geolocation watch that drives a pulsing blue-dot
 *     marker (solid dot, animated halo, accuracy circle) and publishes the
 *     position so the page can react without holding a ref to the map.
 *  2. Long-press. A pure-pointer long-press timer on the map canvas. On fire it
 *     snaps to a nearby address/landmark feature when one is visible near the
 *     touch, drops the destination pin, and asks the routing worker for both
 *     profiles. The follow-on MapLibre `click` is suppressed for a beat so a
 *     pin drop does not also clear the feature popup.
 *  3. Layout. The destination pin, route line, and every marker are MapLibre
 *     sources/layers that must survive a basemap `setStyle` - `rehydrate()`
 *     re-adds whatever is live, the same way the live layers resync.
 */

import type { Map, GeoJSONSource, ExpressionSpecification } from "maplibre-gl";
import { loadLayer } from "../layer-data";
import { featureCentre } from "../feature-index";
import { resolveFeatureLabel } from "../feature-label";
import { computeRoutes, type RouteLeg, type RouteMap } from "./client";
import { ROUTE_MODES, type RouteMode } from "./profiles";
import { deriveSteps, type NavigationStep, bearingDeg, haversineM, pointAtDistance } from "./steps";
import { easeInOutCubic, isPlausibleTransition, lerpAngle, lerpPoint } from "./motion";
import { ARRIVAL_SPEECH, spokenApproach, spokenDeparture, spokenManeuver } from "./voice";
import type { UserLocation, Destination, LocationStatus, RouteStatus, NavigationState, FollowMode } from "./types";

// Re-export types for consumers
export type { NavigationState, FollowMode, LocationStatus, RouteStatus, RouteMode } from "./types";
export type { Destination, UserLocation } from "./types";

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

const LONG_PRESS_MS = 600;
const MAX_DRIFT_PX = 12;
const SNAP_RADIUS_PX = 15;
const SUPPRESS_CLICK_MS = 700;

/** Orange pin colours (#f43f5e is the subsea-cable rose, kept for the pin). */
/**
 * Visual constants. The route is Google-blue, the pin Google-red and the
 * live dot the light-palette GPS blue — they read well on the OpenFreeMap
 * Liberty basemap.
 */
const PIN_COLOR = "#d93025";
const PIN_RING = "rgba(217, 48, 37, 0.22)";
const DOT_COLOR = "#1a73e8";
const DOT_HALO = "#4285f4";
const MANEUVER_COLOR = "#202124";
const MANEUVER_RING = "rgba(32, 33, 36, 0.20)";
const ACCURACY_FILL = "rgba(26, 115, 232, 0.10)";
const ACCURACY_STROKE = "rgba(26, 115, 232, 0.35)";
const ROUTE_COLOR = "#1a73e8";

/** Lateral distance (m) beyond which the user is considered off-route. */
const OFF_ROUTE_M: Record<RouteMode, number> = { driving: 35, cycling: 25, walking: 25 };
/** Arrival radius (m). */
const ARRIVED_M = 15;
/** Delay before auto-recalculating after the first off-route detection. */
const RECALC_DEBOUNCE_MS = 3500;
/** Minimum gap between fix-driven retries after a failed route request. */
const ROUTE_RETRY_COOLDOWN_MS = 10_000;

/**
 * Layers whose features are worth snapping a long-press to. These carry a
 * human-readable name/address (house numbers, toponyms, bus stops, EV points,
 * heritage sites...). Road-centreline hits are deliberately excluded: dropping
 * a pin "on a road" shows the two addresses it joins, not the road.
 */
const SNAP_LAYER_IDS = new Set([
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

const SOURCE_USER = "om-nav-user";
const SOURCE_DEST = "om-nav-destination";
const SOURCE_ROUTE = "om-nav-route";
const SOURCE_MANEUVER = "om-nav-maneuver";

const ROUTE_LAYERS = [
  `${SOURCE_ROUTE}-casing`,
  `${SOURCE_ROUTE}-glow`,
  `${SOURCE_ROUTE}-main`,
];
const USER_LAYERS = [
  `${SOURCE_USER}-accuracy`,
  `${SOURCE_USER}-halo`,
  `${SOURCE_USER}-dot`,
];
const DEST_LAYERS = [`${SOURCE_DEST}-ring`, `${SOURCE_DEST}-pin`];
const MANEUVER_LAYERS = [`${SOURCE_MANEUVER}-ring`, `${SOURCE_MANEUVER}-dot`];

/** metres per pixel at lat = the island's mid-latitude, per zoom. */
const ACCURACY_MULTIPLIERS: [number, number][] = [
  [8, 0.0028],
  [9, 0.0056],
  [10, 0.0112],
  [11, 0.0224],
  [12, 0.0447],
  [13, 0.0894],
  [14, 0.1789],
  [15, 0.3577],
  [16, 0.7154],
  [17, 1.4308],
  [18, 2.8617],
  [19, 5.7233],
  [20, 11.4467],
];

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

type Internal = {
  locationStatus: LocationStatus;
  locationError: string | null;
  userLocation: UserLocation | null;
  /** Smoothed position actually drawn on the map (eases toward userLocation). */
  displayPos: UserLocation | null;
  /** Latest fix the display is easing toward; the animation target. */
  targetPos: UserLocation | null;
  /** Smoothed heading actually drawn (rotated camera), degrees. */
  displayHeadingDeg: number | null;
  destination: Destination | null;
  activeMode: RouteMode;
  routeStatus: RouteStatus;
  routeError: string | null;
  routes: RouteMap;
  steps: NavigationStep[];
  /** Copy of what was last published, to skip no-op renders. */
  lastSignature: string;
  /** Whether the button press is still owed its first fly-to. */
  firstFlyPending: boolean;
  /** A route was computed since the pin dropped / location arrived. */
  routesFresh: boolean;
  /** Set when the user asked for a route (Navigate) so the view fits it. */
  fitPending: boolean;
  /** Map dragged away from the live dot while tracking; see NavigationState. */
  recenterPending: boolean;
  /** Camera follow state: none = manual, follow = center on dot, heading = rotate to heading. */
  followMode: FollowMode;
  /** Spoken guidance on/off. Persisted so the choice survives a reload. */
  voiceMuted: boolean;
  /** True when the user has deviated from the route and a recalc is pending. */
  offRoute: boolean;
  /** True once Navigate is pressed; gates spoken guidance. */
  navigating: boolean;
  /** Distance along the route from the user's position (metres). */
  progressM: number;
  /** Distance remaining to destination (metres). */
  remainingM: number;
  /** Live speed from successive GPS fixes (mph). null until two fixes. */
  speedMph: number | null;
  /** Posted speed limit of the road under the user (km/h). null when untagged. */
  speedLimitKmh: number | null;
  /** Compass bearing between the two most recent GPS fixes, deg. */
  headingDeg: number | null;
  /** Full turn-by-turn legs as first derived (before live trimming). */
  baseSteps: NavigationStep[];
  /** Index of the next unfinished leg (0 = the first). */
  stepIndex: number;
    /** Distance to the next maneuver, metres. */
    nextStepM: number;
    /** Map point of the next maneuver (end of the current leg), or null. */
    nextManeuver: [number, number] | null;
  /** Timestamps for speed/heading derivation. */
  lastFixAt: number;
  /** Previous GPS fix, used to derive speed + heading between fixes. */
  prevFix: UserLocation | null;
};

/** Spoken guidance starts muted only if the user muted it on a previous visit. */
function voiceMutedFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("om-voice-muted") === "1";
  } catch {
    return false;
  }
}

function initialState(activeMode: RouteMode): Internal {
  return {
    locationStatus: "idle",
    locationError: null,
    userLocation: null,
    displayPos: null,
    targetPos: null,
    displayHeadingDeg: null,
    destination: null,
    activeMode,
    routeStatus: "idle",
    routeError: null,
    routes: {},
    steps: [],
    lastSignature: "",
    firstFlyPending: false,
    routesFresh: false,
    fitPending: false,
    recenterPending: false,
    followMode: "none",
    voiceMuted: voiceMutedFromStorage(),
    offRoute: false,
    navigating: false,
    progressM: 0,
    remainingM: 0,
    speedMph: null,
    headingDeg: null,
    speedLimitKmh: null,
    baseSteps: [],
    stepIndex: 0,
    nextStepM: 0,
    nextManeuver: null,
    lastFixAt: 0,
    prevFix: null,
  };
}

/** Cheap stable signature of everything the UI renders. Geometry excluded. */
function signature(s: Internal): string {
  const loc = s.userLocation
    ? `${s.userLocation.lon.toFixed(5)},${s.userLocation.lat.toFixed(5)},${s.userLocation.accuracyM ?? ""}`
    : "";
  return JSON.stringify([
    s.locationStatus,
    s.locationError,
    loc,
    s.destination ? `${s.destination.lon.toFixed(5)},${s.destination.lat.toFixed(5)},${s.destination.title},${s.destination.detail}` : "",
    s.activeMode,
    s.routeStatus,
    s.routeError,
    s.routes.driving ? `${Math.round(s.routes.driving.distanceM)},${Math.round(s.routes.driving.durationS)}` : "n",
    s.routes.walking ? `${Math.round(s.routes.walking.distanceM)},${Math.round(s.routes.walking.durationS)}` : "n",
    s.steps.map((step) => step.distanceM).join(","),
    s.recenterPending,
    s.followMode,
    s.voiceMuted,
    s.offRoute,
    s.navigating,
    Math.round(s.progressM),
    Math.round(s.remainingM),
    s.speedMph === null ? "n" : s.speedMph.toFixed(1),
    s.speedLimitKmh === null ? "n" : s.speedLimitKmh,
    s.stepIndex,
    Math.round(s.nextStepM),
  ]);
}

// ---------------------------------------------------------------------------
// Route-localisation helpers (pure, no map access)
// ---------------------------------------------------------------------------

/**
 * Project a geo point onto a [lon,lat][] polyline.
 *
 * Returns the distance travelled along the polyline up to the closest point,
 * and the lateral (perpendicular) distance from the polyline in metres.
 */
function projectOnRoute(coords: [number, number][], lon: number, lat: number) {
  let alongM = 0;
  let bestLateralM = Infinity;
  let bestAlongM = 0;
  let bestSeg = 0;
  let bestProjLon = coords[0][0];
  let bestProjLat = coords[0][1];
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const segM = haversineM(ax, ay, bx, by);
    if (segM < 1e-6) continue;
    // param u of the point's projection onto segment AB, clamped.
    const dx = (bx - ax) * 111_320 * Math.cos(((ay + by) / 2) * (Math.PI / 180));
    const dy = (by - ay) * 111_320;
    const px = (lon - ax) * 111_320 * Math.cos(((ay + by) / 2) * (Math.PI / 180));
    const py = (lat - ay) * 111_320;
    let u = (px * dx + py * dy) / (dx * dx + dy * dy);
    u = Math.max(0, Math.min(1, u));
    const projLon = ax + (u * (bx - ax));
    const projLat = ay + (u * (by - ay));
    const lateral = haversineM(lon, lat, projLon, projLat);
    const cumulative = alongM + u * segM;
    if (lateral < bestLateralM) {
      bestLateralM = lateral;
      bestAlongM = cumulative;
      bestSeg = i - 1; // segment index: coords[bestSeg] -> coords[bestSeg + 1]
      bestProjLon = projLon;
      bestProjLat = projLat;
    }
    alongM += segM;
  }
  return { distanceM: bestAlongM, lateralM: bestLateralM, segIndex: bestSeg, snappedLon: bestProjLon, snappedLat: bestProjLat };
}

/**
 * Recompute live progress: trimmed steps, next-step countdown, remaining
 * distance, arrival detection and the off-route flag. Uses the user's latest
 * GPS fix projected onto the active route. Called on every fix and whenever a
 * route is (re)computed, so state stays consistent without extra plumbing.
 */
function updateRouteProgress(s: Internal): void {
  const route = s.routes[s.activeMode];
  if (!route || !s.userLocation || !route.coordinates?.length) {
    s.speedLimitKmh = null;
    s.nextManeuver = null;
    return;
  }

  const coords = safeCoords(route);
  if (coords.length < 2) {
    s.progressM = 0;
    s.remainingM = route.distanceM ?? 0;
    s.speedLimitKmh = null;
    s.nextManeuver = null;
    return;
  }

  const proj = projectOnRoute(coords, s.userLocation.lon, s.userLocation.lat);
  const { distanceM, lateralM, segIndex } = proj;
  s.progressM = Math.max(0, distanceM);
  s.remainingM = Math.max(0, (route.distanceM ?? 0) - s.progressM);
  s.speedLimitKmh = route.segmentMaxspeed?.[segIndex] ?? null;

  // Advance past legs whose cumulative length the user has covered.
  let cum = 0;
  let idx = 0;
  for (let i = 0; i < s.baseSteps.length; i++) {
    cum += s.baseSteps[i].distanceM;
    if (cum > s.progressM) break;
    idx = i + 1;
  }
  s.stepIndex = Math.min(idx, s.baseSteps.length);
  // Distance to the END of the current leg: the next maneuver. (stepIndex is
  // the count of legs already completed, so the current leg is stepIndex.)
  const nextCumEnd = s.baseSteps
    .slice(0, s.stepIndex + 1)
    .reduce((a, b) => a + b.distanceM, 0);
  s.nextStepM = Math.max(0, nextCumEnd - s.progressM);

  // Mark the next turn on the map, but never the destination itself (the pin
  // already covers that) - only intermediate maneuvers.
  s.nextManeuver =
    s.stepIndex < s.baseSteps.length - 1 ? pointAtDistance(coords, nextCumEnd) : null;

  const finalCoord = coords[coords.length - 1];
  const distToDestinationM = haversineM(proj.snappedLon, proj.snappedLat, finalCoord[0], finalCoord[1]);
  const off = lateralM > OFF_ROUTE_M[s.activeMode];
  if (distToDestinationM <= ARRIVED_M) {
    s.routeStatus = "arrived";
    s.offRoute = false;
    s.nextManeuver = null;
  } else {
    s.offRoute = off;
    if (!off && s.routeStatus === "arrived") s.routeStatus = "ready";
  }
}

/** Guards against a route whose coordinates were never populated. */
function safeCoords(route: { coordinates?: [number, number][] }): [number, number][] {
  return Array.isArray(route.coordinates) ? route.coordinates : [];
}

// ---------------------------------------------------------------------------
// Layer plumbing shared by first-add and style rehydrate
// ---------------------------------------------------------------------------

/** Paint-layer registration happens once; rehydrate re-runs it after setStyle. */
function addNavLayers(map: Map): void {
  if (!map.getSource(SOURCE_USER)) {
    map.addSource(SOURCE_USER, { type: "geojson", data: emptyCollection() as never });
  }
  if (!map.getLayer(`${SOURCE_USER}-accuracy`)) {
    map.addLayer({
      id: `${SOURCE_USER}-accuracy`,
      type: "circle",
      source: SOURCE_USER,
      paint: {
        "circle-color": ACCURACY_FILL,
        "circle-stroke-color": ACCURACY_STROKE,
        "circle-stroke-width": 1,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          ...ACCURACY_MULTIPLIERS.flatMap(([z, k]) => [
            z,
            ["*", ["get", "accuracy"], k],
          ]),
        ] as unknown as ExpressionSpecification,
      },
    });
  }
  if (!map.getLayer(`${SOURCE_USER}-halo`)) {
    map.addLayer({
      id: `${SOURCE_USER}-halo`,
      type: "circle",
      source: SOURCE_USER,
      paint: {
        "circle-color": DOT_HALO,
        "circle-radius": 10,
        "circle-opacity": 0.35,
      },
    });
  }
  if (!map.getLayer(`${SOURCE_USER}-dot`)) {
    map.addLayer({
      id: `${SOURCE_USER}-dot`,
      type: "circle",
      source: SOURCE_USER,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 18, 8],
        "circle-color": DOT_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getSource(SOURCE_DEST)) {
    map.addSource(SOURCE_DEST, { type: "geojson", data: emptyCollection() as never });
  }
  if (!map.getLayer(`${SOURCE_DEST}-ring`)) {
    map.addLayer({
      id: `${SOURCE_DEST}-ring`,
      type: "circle",
      source: SOURCE_DEST,
      paint: {
        "circle-color": PIN_RING,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 12, 18, 22],
        "circle-stroke-color": PIN_COLOR,
        "circle-stroke-width": 1,
      },
    });
  }
  if (!map.getLayer(`${SOURCE_DEST}-pin`)) {
    map.addLayer({
      id: `${SOURCE_DEST}-pin`,
      type: "circle",
      source: SOURCE_DEST,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 18, 11],
        "circle-color": PIN_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  if (!map.getSource(SOURCE_ROUTE)) {
    map.addSource(SOURCE_ROUTE, { type: "geojson", data: emptyCollection() as never });
  }
  if (!map.getLayer(`${SOURCE_ROUTE}-casing`)) {
    map.addLayer({
      id: `${SOURCE_ROUTE}-casing`,
      type: "line",
      source: SOURCE_ROUTE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.95,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 9, 14, 14, 18, 18],
      },
    });
  }
  if (!map.getLayer(`${SOURCE_ROUTE}-glow`)) {
    map.addLayer({
      id: `${SOURCE_ROUTE}-glow`,
      type: "line",
      source: SOURCE_ROUTE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_COLOR,
        "line-opacity": 0.3,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 10, 18, 13],
      },
    });
  }
  if (!map.getLayer(`${SOURCE_ROUTE}-main`)) {
    map.addLayer({
      id: `${SOURCE_ROUTE}-main`,
      type: "line",
      source: SOURCE_ROUTE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_COLOR,
        "line-opacity": 1,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 4.5, 18, 6],
      },
    });
  }

  // Dedicated blue polyline layer expected by MapLibre route rendering checks.
  if (!map.getLayer("route-layer")) {
    map.addLayer({
      id: "route-layer",
      type: "line",
      source: SOURCE_ROUTE,
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#2563eb",
        "line-width": 6,
        "line-opacity": 0.85,
      },
    });
  }

  if (!map.getSource(SOURCE_MANEUVER)) {
    map.addSource(SOURCE_MANEUVER, { type: "geojson", data: emptyCollection() as never });
  }
  if (!map.getLayer(`${SOURCE_MANEUVER}-ring`)) {
    map.addLayer({
      id: `${SOURCE_MANEUVER}-ring`,
      type: "circle",
      source: SOURCE_MANEUVER,
      paint: {
        "circle-color": MANEUVER_RING,
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 11, 18, 18],
        "circle-stroke-color": MANEUVER_COLOR,
        "circle-stroke-width": 1,
      },
    });
  }
  if (!map.getLayer(`${SOURCE_MANEUVER}-dot`)) {
    map.addLayer({
      id: `${SOURCE_MANEUVER}-dot`,
      type: "circle",
      source: SOURCE_MANEUVER,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5, 18, 8],
        "circle-color": MANEUVER_COLOR,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }

  liftNavLayers(map);
}

function emptyCollection(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}

/** Keep markers and the route above every data layer (top = last painted). */
function liftNavLayers(map: Map): void {
  const order = [
    ...ROUTE_LAYERS,
    "route-layer",
    ...MANEUVER_LAYERS,
    ...USER_LAYERS,
    ...DEST_LAYERS,
  ];
  for (const id of order) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// ---------------------------------------------------------------------------
// Long-press detection (pure pointer math, MapLibre-independent except canvas)
// ---------------------------------------------------------------------------

interface PressState {
  pointerId: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout> | null;
}

function cancelPress(press: PressState | null): void {
  if (press?.timer) clearTimeout(press.timer);
}

// ---------------------------------------------------------------------------
// attachNavigation
// ---------------------------------------------------------------------------

export function attachNavigation(map: Map, opts: AttachOptions): NavigationHost {
  // If the style has no nav layers at all (e.g. it was swapped), get them back.
  let navLayersReady = false;
  const ensureLayers = () => {
    if (!navLayersReady) {
      addNavLayers(map);
      navLayersReady = true;
    }
  };

  // The host usually attaches before the style is loaded. Source/layer adds
  // would throw "Style is not done loading", so wait for the first load when we
  // have to. Later style swaps are re-hydrated by rehydrate()/resync.
  if (map.isStyleLoaded()) {
    ensureLayers();
  } else {
    const onLoad = () => {
      ensureLayers();
      map.off("load", onLoad);
    };
    map.on("load", onLoad);
  }

  const state: Internal = initialState("driving");

  // Announcements already made, keyed per leg/threshold, so each is spoken
  // once. Reset whenever a fresh route is set.
  let spokenKeys = new Set<string>();

  const publish = () => {
    // GPS-driven progress (progress/remaining/off-route/arrived/next step)
    // is derived state, recomputed here so every published snapshot is fresh
    // no matter which event triggered it.
    updateRouteProgress(state);
    drawManeuver(state.nextManeuver);
    maybeSpeak();
    const sig = signature(state);
    if (sig === state.lastSignature) return;
    state.lastSignature = sig;
    opts.onState({
      locationStatus: state.locationStatus,
      locationError: state.locationError,
      userLocation: state.userLocation,
      destination: state.destination,
      activeMode: state.activeMode,
      routeStatus: state.routeStatus,
      routeError: state.routeError,
      routes: state.routes,
      steps: state.steps,
      speedMph: state.speedMph,
      speedLimitKmh: state.speedLimitKmh,
      stepIndex: state.stepIndex,
      nextStepM: state.nextStepM,
      recenterPending: state.recenterPending,
      followMode: state.followMode,
      voiceMuted: state.voiceMuted,
      offRoute: state.offRoute,
      navigating: state.navigating,
      progressM: state.progressM,
      remainingM: state.remainingM,
    });
  };

  /** Recompute the displayed legs for whichever route is active right now. */
  const syncSteps = (route?: RouteLeg | null) => {
    state.baseSteps =
      route && route.coordinates.length > 1
        ? deriveSteps(route.coordinates, route.segmentNames, route.segmentJunctions)
        : [];
    state.steps = state.baseSteps;
    state.stepIndex = 0;
    state.nextStepM = state.baseSteps[0]?.distanceM ?? 0;
  };

  // ---- GPS ---------------------------------------------------------------

  let watcherId: number | null = null;
  let pulseFrame = 0;
  let pulseT = 0;
  /** Bumped per route request; a stale reply from an older pin is discarded. */
  let reqToken = 0;
  /** Timestamp of the last failed route request; gates the retry cooldown. */
  let routeErrorAt = 0;

  const setUserData = (loc: UserLocation) => {
    if (!map.getSource(SOURCE_USER)) return;
    (map.getSource(SOURCE_USER) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [loc.lon, loc.lat] },
          properties: { accuracy: loc.accuracyM ?? 0 },
        },
      ],
    } as never);
  };

  const clearUserLayer = () => {
    if (map.getSource(SOURCE_USER)) {
      (map.getSource(SOURCE_USER) as GeoJSONSource).setData(emptyCollection() as never);
    }
  };

  /** Drop (or move) the marker showing where the next turn is. */
  const drawManeuver = (pt: [number, number] | null) => {
    const source = map.getSource(SOURCE_MANEUVER) as GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      pt
        ? ({
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: pt },
                properties: {},
              },
            ],
          } as never)
        : (emptyCollection() as never),
    );
  };

  const stopPulse = () => {
    if (pulseFrame) cancelAnimationFrame(pulseFrame);
    pulseFrame = 0;
  };

  const startPulse = () => {
    if (!state.userLocation || pulseFrame) return;
    const loop = () => {
      pulseT = (pulseT + 16) % 2000;
      // Ease out: a fast in, a long fade. Radius grows, opacity bleeds away.
      const ease = 1 - Math.pow(1 - pulseT / 2000, 3);
      if (map.getLayer(`${SOURCE_USER}-halo`)) {
        map.setPaintProperty(`${SOURCE_USER}-halo`, "circle-radius", 9 + 14 * ease);
        map.setPaintProperty(`${SOURCE_USER}-halo`, "circle-opacity", 0.35 * (1 - ease));
      }
      pulseFrame = requestAnimationFrame(loop);
    };
    pulseFrame = requestAnimationFrame(loop);
  };

  // ---- Smooth follow -----------------------------------------------------
  // Fresh fixes are only half of tracking well: at ~1 Hz the raw dot and camera
  // would step several metres each tick. So the drawn position eases toward
  // each new fix between ticks. Purely visual - publish() still reports the raw
  // fix, so progress, off-route detection and recalc are unaffected.

  /** How long the drawn dot takes to catch up to a new fix. */
  const FOLLOW_ANIM_MS = 400;
  let animFrame = 0;
  let animStartAt = 0;
  let animFrom: UserLocation | null = null;
  let animFromHeading: number | null = null;
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const drawUser = () => {
    if (state.displayPos) setUserData(state.displayPos);
  };

  /** Move the camera to the smoothed dot, when following and not parked. */
  const cameraToDisplay = () => {
    const p = state.displayPos;
    if (!p || state.followMode === "none" || state.recenterPending) return;
    if (state.followMode === "heading" && state.displayHeadingDeg !== null) {
      map.setBearing(state.displayHeadingDeg);
    }
    map.setCenter([p.lon, p.lat]);
  };

  const stopFollowAnim = () => {
    if (animFrame) cancelAnimationFrame(animFrame);
    animFrame = 0;
  };

  const runFollowAnim = (now: number) => {
    animFrame = 0;
    const target = state.targetPos;
    if (!target) return;
    const t = animFrom ? easeInOutCubic((now - animStartAt) / FOLLOW_ANIM_MS) : 1;
    const p = animFrom ? lerpPoint(animFrom, target, t) : target;
    state.displayPos = {
      ...p,
      accuracyM: target.accuracyM,
      timestamp: target.timestamp,
    };
    state.displayHeadingDeg = lerpAngle(animFromHeading, state.headingDeg, t);
    drawUser();
    cameraToDisplay();
    if (t < 1) {
      animFrame = requestAnimationFrame(runFollowAnim);
    } else {
      state.displayPos = target;
      drawUser();
    }
  };

  const startFollowAnim = () => {
    if (!state.targetPos) return;
    if (reduceMotion) {
      state.displayPos = state.targetPos;
      state.displayHeadingDeg = state.headingDeg;
      drawUser();
      cameraToDisplay();
      return;
    }
    animFrom = state.displayPos;
    animFromHeading = state.displayHeadingDeg;
    animStartAt = performance.now();
    // A frame may already be pending from a fix arriving mid-ease; it will pick
    // up the new target and origin on its next tick.
    if (animFrame === 0) animFrame = requestAnimationFrame(runFollowAnim);
  };

  // ---- Voice guidance ----------------------------------------------------
  // Web Speech reads the geometry-derived maneuvers. Purely optional: if the
  // browser has no synthesis, everything else carries on silently.

  /** Distance at which the pre-turn warning is spoken. */
  const VOICE_APPROACH_M = 400;
  /** Distance at which the imminent ("now") instruction is spoken. */
  const VOICE_NOW_M = 90;

  const cancelSpeech = () => {
    if (typeof window === "undefined") return;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* synthesis unavailable */
    }
  };

  const speakText = (text: string) => {
    if (state.voiceMuted || typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    try {
      // One instruction at a time: drop anything still queued.
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      synth.speak(utterance);
    } catch {
      /* a failed utterance must never break navigation */
    }
  };

  const maybeSpeak = () => {
    if (state.voiceMuted || !state.navigating || !state.destination) return;
    if (state.routeStatus === "arrived") {
      if (!spokenKeys.has("arrived")) {
        spokenKeys.add("arrived");
        speakText(ARRIVAL_SPEECH);
      }
      return;
    }
    if (state.routeStatus !== "ready" && state.routeStatus !== "recalculating") return;

    // The maneuver ahead ends the current leg, i.e. the next step in the list.
    const nextIdx = state.stepIndex + 1;
    const upcoming = state.baseSteps[nextIdx];

    if (state.stepIndex === 0 && !spokenKeys.has("depart")) {
      spokenKeys.add("depart");
      speakText(spokenDeparture(state.baseSteps[0] ?? null));
      return;
    }
    if (!upcoming) return;
    if (state.nextStepM <= VOICE_APPROACH_M && !spokenKeys.has(`${nextIdx}-approach`)) {
      spokenKeys.add(`${nextIdx}-approach`);
      speakText(spokenApproach(upcoming, state.nextStepM));
    } else if (state.nextStepM <= VOICE_NOW_M && !spokenKeys.has(`${nextIdx}-now`)) {
      spokenKeys.add(`${nextIdx}-now`);
      speakText(spokenManeuver(upcoming));
    }
  };

  const onGeolocation = (pos: GeolocationPosition) => {
    const lon = pos.coords.longitude;
    const lat = pos.coords.latitude;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

    const now = pos.timestamp;
    const dtS = state.lastFixAt ? (now - state.lastFixAt) / 1000 : 0;
    const prevLoc = state.prevFix;

    // A fix implying an impossible speed over the elapsed time is a dropout or
    // a jump between cell/wifi and GPS, not motion. Following it would fling the
    // dot and drag the camera with it, so drop it and wait for the next.
    if (
      prevLoc &&
      !isPlausibleTransition({ lon: prevLoc.lon, lat: prevLoc.lat }, { lon, lat }, dtS)
    ) {
      return;
    }

    const loc: UserLocation = {
      lon,
      lat,
      accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
      timestamp: now,
    };
    state.userLocation = loc;

    // Lock the drawn marker to the active route geometry when one exists, so
    // GPS drift does not pull the dot off the road. Progress/recalc still use
    // the raw fix stored in userLocation.
    let drawTarget = loc;
    if (state.destination && state.routes[state.activeMode]?.coordinates?.length) {
      const activeRoute = state.routes[state.activeMode];
      if (activeRoute) {
        const proj = projectOnRoute(activeRoute.coordinates as [number, number][], lon, lat);
        drawTarget = {
          ...loc,
          lon: proj.snappedLon,
          lat: proj.snappedLat,
        };
      }
    }
    state.targetPos = drawTarget;
    state.locationStatus = "active";
    state.locationError = null;
    startPulse();

    // ---- Live speed + heading: prefer the device's own sensors ------------
    // coords.speed (m/s) and coords.heading (deg) are more reliable and more
    // immediate than differencing two fixes, and heading is reported even when
    // barely moving. Fall back to the two-fix derivation only when absent.
    state.lastFixAt = now;
    state.prevFix = loc;
    const nativeSpeed = pos.coords.speed;
    const nativeHeading = pos.coords.heading;
    const haveSpeed =
      typeof nativeSpeed === "number" && Number.isFinite(nativeSpeed) && nativeSpeed >= 0;
    const haveHeading = typeof nativeHeading === "number" && Number.isFinite(nativeHeading);
    if ((!haveSpeed || !haveHeading) && prevLoc && dtS > 0.3 && dtS < 30) {
      // haversineM takes (lon, lat) pairs; passing lat first mirrored both
      // fixes across the equator, so the derived speed/heading were wrong on
      // devices that omit coords.speed/coords.heading.
      const dist = haversineM(prevLoc.lon, prevLoc.lat, lon, lat);
      if (dist > 1) {
        if (!haveSpeed) state.speedMph = (dist / dtS) * 2.2369363;
        if (!haveHeading) state.headingDeg = bearingDeg(prevLoc.lon, prevLoc.lat, lon, lat);
      }
    }
    if (haveSpeed) state.speedMph = nativeSpeed * 2.2369363;
    if (haveHeading) state.headingDeg = nativeHeading;

    // ---- Camera: follow the dot / rotate to course -----------------------
    // In "none" mode the map is never yanked (the button-driven Recenter flow
    // still works). In follow/heading modes the camera tracks the GPS dot
    // unless the user dragged the map away, which parks until they Recentre.
    state.recenterPending = state.followMode !== "none" ? state.recenterPending : false;

    // First fix after the button press pans to the user; later fixes just move
    // the dot so the map is never yanked away while they are looking.
    if (state.firstFlyPending) {
      state.firstFlyPending = false;
      state.displayPos = loc;
      state.displayHeadingDeg = state.headingDeg;
      drawUser();
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
    } else {
      startFollowAnim();
    }

    // Re-route when a fix lands and the route is missing, but never
    // stampede: while a request is in flight the old behaviour fired a new
    // one every fix (~1 Hz), each bumping reqToken and discarding the
    // previous reply - if routing took longer than the fix interval the
    // route could never settle. Errors cool down instead of retrying at
    // fix rate too.
    const routeBusy =
      state.routeStatus === "loading" || state.routeStatus === "recalculating";
    const routeCoolingDown =
      state.routeStatus === "error" && now - routeErrorAt < ROUTE_RETRY_COOLDOWN_MS;
    if (state.destination && !state.routesFresh && !routeBusy && !routeCoolingDown) {
      void requestRoutes();
    }
    publish();

    // Driving off the drawn line: hand off to an auto-recalculate. Status is
    // bumped here (not in requestRoutes) so the UI shows "recalculating".
    if (state.offRoute && state.routeStatus === "ready") {
      scheduleRecalc();
    }
  };

  const onGeolocationError = (err: GeolocationPositionError) => {
    const messages: Record<number, string> = {
      1: "Location permission denied. Allow location access to use locate-me.",
      2: "Position unavailable. Check that GPS/location is switched on.",
      3: "Location request timed out. Try again.",
    };
    state.locationStatus = "error";
    state.locationError = messages[err.code] ?? `Location error ${err.code}.`;
    state.recenterPending = false;
    stopPulse();
    publish();
  };

  const startLocation = () => {
    if (!("geolocation" in navigator)) {
      state.locationStatus = "error";
      state.locationError = "Geolocation is not supported by this browser.";
      publish();
      return;
    }
    if (watcherId !== null) return;
    ensureLayers();
    state.locationStatus = "locating";
    state.firstFlyPending = true;
    state.recenterPending = false;
    publish();
    watcherId = navigator.geolocation.watchPosition(onGeolocation, onGeolocationError, {
      enableHighAccuracy: true,
      // Accept only fresh fixes. A cached 30 s-old position was why tracking
      // lagged behind the driver and the speed read stale.
      maximumAge: 0,
      timeout: 25_000,
    });
  };

  const stopLocation = () => {
    if (watcherId !== null) {
      navigator.geolocation.clearWatch(watcherId);
      watcherId = null;
    }
    stopPulse();
    stopFollowAnim();
    cancelSpeech();
    spokenKeys = new Set<string>();
    reqToken++;
    clearRecalc();
    state.userLocation = null;
    state.displayPos = null;
    state.targetPos = null;
    state.displayHeadingDeg = null;
    state.nextManeuver = null;
    state.firstFlyPending = false;
    state.recenterPending = false;
    state.speedMph = null;
    state.headingDeg = null;
    state.speedLimitKmh = null;
    state.prevFix = null;
    state.lastFixAt = 0;
    state.routes = {};
    state.steps = [];
    state.baseSteps = [];
    state.stepIndex = 0;
    state.nextStepM = 0;
    state.routesFresh = false;
    if (state.locationStatus === "active" || state.locationStatus === "locating") {
      state.locationStatus = "idle";
    }
    clearUserLayer();
    clearRouteLayer();
    publish();
  };

  // ---- Destination + route ----------------------------------------------

  const setDestinationData = (lon: number, lat: number) => {
    if (!map.getSource(SOURCE_DEST)) return;
    (map.getSource(SOURCE_DEST) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lon, lat] },
          properties: {},
        },
      ],
    } as never);
  };

  const drawRoute = (route: RouteLeg | null | undefined) => {
    const source = map.getSource(SOURCE_ROUTE) as GeoJSONSource | undefined;
    if (!source) return;
    if (!route) {
      source.setData(emptyCollection() as never);
      return;
    }
    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: route.coordinates },
          properties: {},
        },
      ],
    } as never);
  };

  const clearRouteLayer = () => {
    if (map.getSource(SOURCE_ROUTE)) {
      (map.getSource(SOURCE_ROUTE) as GeoJSONSource).setData(emptyCollection() as never);
    }
    drawManeuver(null);
  };

  const routeBounds = (route: RouteLeg): [[number, number], [number, number]] => {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const [lon, lat] of route.coordinates) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    return [
      [minLon, minLat],
      [maxLon, maxLat],
    ];
  };

  const fitRoute = (route: RouteLeg) => {
    map.fitBounds(routeBounds(route), {
      // Uniform and small. The map's persistent bottom padding (kept in sync
      // with the live destination-sheet height by MapView) is what keeps the
      // route above the sheet; a large hard-coded bottom here would double up
      // and shove the route off-centre once both apply.
      padding: 40,
      duration: 700,
      maxZoom: 16,
    });
  };

    // ---- Auto-recalculate after driving off route -------------------------

  let recalcTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRecalc = () => {
    if (recalcTimer) {
      clearTimeout(recalcTimer);
      recalcTimer = null;
    }
  };

  /**
   * Turn an off-route detection into a "recalculating" status and, after a
   * short glance-free grace period (enough to notice and correct a wrong turn
   * without the route thrashing on GPS jitter), re-run the routing. Only
   * fires once per off-route event; the new route starts from the current fix
   * and is drawn already snapped to the road, so the flag clears itself.
   */
  const scheduleRecalc = () => {
    if (state.routeStatus !== "ready") return;
    state.routeStatus = "recalculating";
    clearRecalc();
    recalcTimer = setTimeout(() => {
      recalcTimer = null;
      void requestRoutes();
    }, RECALC_DEBOUNCE_MS);
    publish();
  };

  const requestRoutes = async (): Promise<void> => {
    const dest = state.destination;
    const loc = state.userLocation;
    if (!dest || !loc) return;

    const token = ++reqToken;
    state.routeStatus = "loading";
    state.routeError = null;
    publish();

    const reply = await computeRoutes(loc, dest, ROUTE_MODES);
    if (token !== reqToken) return; // a newer drop superseded this one
    if (!reply.ok) {
      state.routeStatus = "error";
      routeErrorAt = Date.now();
      state.routeError = reply.error ?? "Routing failed.";
      state.routes = {};
      state.steps = [];
      state.baseSteps = [];
      state.stepIndex = 0;
      state.nextStepM = 0;
      publish();
      return;
    }

    state.routes = reply.routes;
    state.routesFresh = true;
    const active = reply.routes[state.activeMode];
    const bothNull = !reply.routes.driving && !reply.routes.walking;
    if (bothNull) {
      state.routeStatus = "no-route";
      state.routeError =
        "No road route between your position and this pin. It may be away from the road network.";
    } else {
      state.routeStatus = "ready";
      state.routeError = null;
    }
    drawRoute(active);
    syncSteps(active);
    liftNavLayers(map);
    if (state.fitPending && active) {
      state.fitPending = false;
      fitRoute(active);
    }
    publish();
  };

  const setActiveMode = (mode: RouteMode) => {
    state.activeMode = mode;
    // Switching mode is a fresh set of maneuvers: re-announce them.
    spokenKeys = new Set<string>();
    cancelSpeech();
    if (state.routesFresh) {
      const route = state.routes[mode];
      drawRoute(route);
      syncSteps(route);
    }
    publish();
  };

  const clearDestination = () => {
    reqToken++;
    clearRecalc();
    cancelSpeech();
    spokenKeys = new Set<string>();
    state.destination = null;
    state.navigating = false;
    state.routes = {};
    state.steps = [];
    state.baseSteps = [];
    state.stepIndex = 0;
    state.nextStepM = 0;
    state.routesFresh = false;
    state.routeStatus = "idle";
    state.routeError = null;
    state.offRoute = false;
    state.fitPending = false;
    setDestinationData(0, 0);
    clearRouteLayer();
    publish();
  };

  // ---- Metadata for a dropped pin ---------------------------------------

  /** Nearest named place, from the toponyms layer, for unstructured pins. */
  let toponyms: { lon: number; lat: number; name: string }[] | null = null;
  const nearestPlace = async (lon: number, lat: number): Promise<string | null> => {
    if (!toponyms) {
      try {
        const fc = await loadLayer("toponyms.geojson");
        const list = fc.features
          .map((f) => {
            const centre = featureCentre(f.geometry);
            const props = f.properties;
            if (!centre) return null;
            const name =
              typeof props?.name === "string" && props.name ? props.name : resolveFeatureLabel(props);
            if (!name || name === "(unnamed)") return null;
            return { lon: centre[0], lat: centre[1], name };
          })
          .filter((x): x is { lon: number; lat: number; name: string } => x !== null);
        toponyms = list;
      } catch {
        return null;
      }
    }
    let best: { d: number; name: string } | null = null;
    for (const t of toponyms) {
      const d = Math.hypot(t.lon - lon, t.lat - lat);
      if (!best || d < best.d) best = { d, name: t.name };
    }
    if (!best || best.d > 0.03) return null; // ~2.5 km at this latitude
    return best.name;
  };

  const addressOf = (props: Record<string, unknown> | null): string => {
    if (!props) return "";
    const parts: string[] = [];
    if (typeof props.housenumber === "string" && props.housenumber) parts.push(props.housenumber);
    else if (typeof props.housename === "string" && props.housename) parts.push(props.housename);
    if (typeof props.street === "string" && props.street) parts.push(props.street);
    if (typeof props.suburb === "string" && props.suburb) parts.push(props.suburb);
    if (typeof props.place === "string" && props.place) parts.push(props.place);
    if (typeof props.postcode === "string" && props.postcode) parts.push(props.postcode);
    return parts.join(", ");
  };

  const dropDestination = (lon: number, lat: number, title: string, detail: string) => {
    const dest: Destination = { lon, lat, title, detail };
    state.destination = dest;
    // A new destination starts a fresh preview: no spoken guidance yet.
    state.navigating = false;
    spokenKeys = new Set<string>();
    cancelSpeech();
    state.routesFresh = false;
    state.routeStatus = "idle";
    state.routeError = null;
    setDestinationData(lon, lat);
    liftNavLayers(map);
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 15), duration: 700 });
    if (state.userLocation) void requestRoutes();
    publish();
  };

  /** Long-press hit: snap to a visible address/landmark feature within 15px. */
  const resolveHit = (x: number, y: number): { lon: number; lat: number; title: string; detail: string } => {
    const r = SNAP_RADIUS_PX;
    let hits: unknown[] = [];
    try {
      const existingLayers = new Set((map.getStyle().layers || []).map((l) => l.id));
      const layerFilters = [...SNAP_LAYER_IDS]
        .map((id) => `om-${id}-circle`)
        .filter((lid) => existingLayers.has(lid));
      if (layerFilters.length > 0) {
        hits = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], {
          layers: layerFilters,
        });
      }
    } catch (err) {
      console.warn("[nav] queryRenderedFeatures failed:", err);
      hits = [];
    }

    let best: { d2: number; lon: number; lat: number; props: Record<string, unknown> | null } | null = null;
    for (const hit of hits as unknown[]) {
      const h = hit as { geometry?: unknown; properties?: Record<string, unknown> | null };
      const centre = featureCentre(h.geometry as GeoJSON.Geometry | undefined);
      if (!centre) continue;
      const pt = map.project([centre[0], centre[1]]);
      const d2 = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (d2 > r * r) continue;
      if (!best || d2 < best.d2) {
        best = { d2, lon: centre[0], lat: centre[1], props: h.properties ?? null };
      }
    }

    if (best) {
      const title = resolveFeatureLabel(best.props);
      const detail = addressOf(best.props);
      return {
        lon: best.lon,
        lat: best.lat,
        title: title && title !== "(unnamed)" ? title : "Pinned location",
        detail,
      };
    }

    const lngLat = map.unproject([x, y]);
    return {
      lon: lngLat.lng,
      lat: lngLat.lat,
      title: "Pinned location",
      detail: "",
    };
  };

  const onLongPress = async (x: number, y: number) => {
    ensureLayers();
    opts.suppressClickUntil.current = Date.now() + SUPPRESS_CLICK_MS;
    const hit = resolveHit(x, y);
    if (!hit.detail) {
      const place = await nearestPlace(hit.lon, hit.lat);
      hit.detail = place ?? `${hit.lat.toFixed(5)}, ${hit.lon.toFixed(5)}`;
    }
    dropDestination(hit.lon, hit.lat, hit.title, hit.detail);
  };

  // ---- Pointer listeners on the canvas -----------------------------------

  let press: PressState | null = null;

  const canvas = map.getCanvas();

  const onPointerDown = (e: PointerEvent) => {
    // Ignore non-primary pointers entirely; a second finger cancels this press.
    if (!e.isPrimary) {
      cancelPress(press);
      press = null;
      return;
    }
    cancelPress(press);

    // Long-presses and map gestures both start with a press on this canvas.
    // Keep the press alive only while the finger stays near where it landed;
    // anything past MAX_DRIFT_PX is a pan/pinch and not a long-press.
    const x = e.clientX;
    const y = e.clientY;
    press = {
      pointerId: e.pointerId,
      x,
      y,
      timer: setTimeout(() => {
        if (!press) return;
        void onLongPress(x, y);
      }, LONG_PRESS_MS),
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MAX_DRIFT_PX) {
      cancelPress(press);
      press = null;
    }
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (press && e.pointerId === press.pointerId) {
      cancelPress(press);
      press = null;
    }
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerEnd);
  canvas.addEventListener("pointercancel", onPointerEnd);

  // ---- Window events from the UI ----------------------------------------

  const ensureLayersAndRoute = () => {
    ensureLayers();
    const shown = state.displayPos ?? state.userLocation;
    if (shown) setUserData(shown);
    if (state.destination) setDestinationData(state.destination.lon, state.destination.lat);
    const active = state.routes[state.activeMode];
    if (state.routesFresh && active) drawRoute(active);
    drawManeuver(state.nextManeuver);
    liftNavLayers(map);
  };

  const onLocateEvent = () => {
    ensureLayers();
    if (state.locationStatus === "active" && watcherId !== null) {
      // The map was dragged away from the live dot and a "Recenter" badge is
      // showing: this press flies back to the user and resumes following.
      // Otherwise the button is the way to stop live tracking.
      if (state.recenterPending && state.userLocation) {
        state.recenterPending = false;
        state.firstFlyPending = false;
        // Snap the drawn dot to the real fix so it lands under the camera.
        state.displayPos = state.userLocation;
        state.displayHeadingDeg = state.headingDeg;
        drawUser();
        map.flyTo({
          center: [state.userLocation.lon, state.userLocation.lat],
          zoom: Math.max(map.getZoom(), 16),
          duration: 700,
        });
        publish();
        return;
      }
      stopLocation();
      return;
    }
    if (watcherId !== null) {
      // Still searching for a first fix; a second press cancels the watch.
      stopLocation();
      return;
    }
    startLocation();
  };

  /**
   * The user pulled the map away from their own position while tracking is on.
   * That is the one visual signal that "I am drifting, bring me back" is real:
   * the dot keeps moving while the camera no longer follows, so the UI must
   * say so instead of leaving the reader to notice it. Programmatic moves
   * (flyTo/fitBounds) do not fire dragstart, so only genuine pan gestures land
   * here.
   */
  const onDragStart = () => {
    if (
      state.locationStatus === "active" &&
      watcherId !== null &&
      state.userLocation &&
      !state.recenterPending
    ) {
      state.recenterPending = true;
      publish();
    }
  };
  map.on("dragstart", onDragStart);

  const onNavigateEvent = () => {
    ensureLayers();
    if (!state.destination) return;
    state.navigating = true;
    state.fitPending = true;
    // Jump into tracking so the view follows the car once the route is live;
    // the user dials heading-up from the follow button if they want it. A
    // fresh Navigate also clears any parked "Recenter" so following resumes.
    state.followMode = "follow";
    state.recenterPending = false;
    if (!state.userLocation) {
      // No fix yet: ask for one; requestRoutes fires when the fix lands.
      state.routeError = null;
      startLocation();
      publish();
      return;
    }
    void requestRoutes();
  };

  const onModeEvent = (mode: RouteMode) => {
    if (mode === state.activeMode) return;
    setActiveMode(mode);
  };

  const onClearEvent = () => {
    ensureLayers();
    clearDestination();
    if (press) {
      cancelPress(press);
      press = null;
    }
  };

  /**
   * openmannin:set-destination — a "Directions" press anywhere in the app (in
   * particular the feature popup) turns the picked feature into a destination
   * pin and computes routes to it, exactly like a long-press drop.
   */
  const onSetDestinationWindow = (e: Event) => {
    e.stopPropagation();
    const d = ((e as CustomEvent).detail ?? {}) as {
      lon?: unknown;
      lat?: unknown;
      title?: unknown;
      detail?: unknown;
    };
    if (typeof d.lon !== "number" || typeof d.lat !== "number") return;
    ensureLayers();
    dropDestination(
      d.lon,
      d.lat,
      typeof d.title === "string" && d.title ? d.title : "Pinned location",
      typeof d.detail === "string" ? d.detail : "",
    );
  };

  /**
   * openmannin:nav-follow modes: "none" frees the camera, "follow" pins it to
   * the live dot, "heading" additionally rotates the map so the current course
   * points up. Picks up the next GPS fix if there is no heading to rotate to
   * yet.
   */
  const onFollowEvent = (mode: FollowMode) => {
    state.followMode = mode;
    if (mode === "none") {
      stopFollowAnim();
    } else {
      // Follow/heading engaged: move to the smoothed dot now rather than
      // waiting for the next fix, so the button feels immediate.
      state.recenterPending = false;
      startFollowAnim();
    }
    publish();
  };

  const onFollowWindow = (e: Event) => {
    e.stopPropagation();
    onFollowEvent(((e as CustomEvent).detail as { mode?: FollowMode })?.mode ?? "follow");
  };

  const onVoiceEvent = (muted: boolean | undefined) => {
    state.voiceMuted = typeof muted === "boolean" ? muted : !state.voiceMuted;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("om-voice-muted", state.voiceMuted ? "1" : "0");
      } catch {
        /* storage may be unavailable (private mode); the choice is still live */
      }
    }
    // Cutting the voice mid-sentence must stop the current utterance too.
    if (state.voiceMuted) cancelSpeech();
    publish();
  };

  const onVoiceWindow = (e: Event) => {
    e.stopPropagation();
    onVoiceEvent(((e as CustomEvent).detail as { muted?: boolean })?.muted);
  };

  const onLocateWindow = (e: Event) => {
    e.stopPropagation();
    onLocateEvent();
  };
  const onNavigateWindow = (e: Event) => {
    e.stopPropagation();
    onNavigateEvent();
  };
  const onModeWindow = (e: Event) => {
    e.stopPropagation();
    onModeEvent(((e as CustomEvent).detail as { mode?: RouteMode })?.mode ?? "driving");
  };
  const onClearWindow = (e: Event) => {
    e.stopPropagation();
    onClearEvent();
  };

  const onNavEndEvent = () => {
    // Redraw the pin, destination and route if a style swap or the nav
    // teardown dropped them - the guard used to test the function for
    // truthiness, which is always true, so this branch was dead.
    ensureLayersAndRoute();
    state.navigating = false;
    spokenKeys = new Set<string>();
    cancelSpeech();
    publish();
  };

  const onNavOverviewEvent = () => {
    ensureLayersAndRoute();
    const active = state.routes[state.activeMode];
    if (active && state.routeStatus === "ready" && !state.offRoute) fitRoute(active);
    else if (active) fitRoute(active);
  };

  window.addEventListener("openmannin:locate", onLocateWindow);
  window.addEventListener("openmannin:navigate", onNavigateWindow);
  window.addEventListener("openmannin:nav-mode", onModeWindow);
  window.addEventListener("openmannin:nav-follow", onFollowWindow);
  window.addEventListener("openmannin:nav-voice", onVoiceWindow);
  window.addEventListener("openmannin:clear-nav", onClearWindow);
  window.addEventListener("openmannin:nav-end", onNavEndEvent);
  window.addEventListener("openmannin:nav-overview", onNavOverviewEvent);
  window.addEventListener("openmannin:set-destination", onSetDestinationWindow);

  // Publish the initial state so the UI renders the controls (the locate
  // button, the dormant destination panel) before any interaction happens.
  publish();

  // ---- Lifespan ---------------------------------------------------------

  return {
    rehydrate() {
      // A basemap style swap wiped every source and layer. Re-register and
      // repaint whatever is still live, exactly like the data layers do.
      navLayersReady = false;
      ensureLayersAndRoute();
      if (state.userLocation) startPulse();
    },
    dispose() {
      stopPulse();
      stopFollowAnim();
      cancelSpeech();
      if (watcherId !== null) navigator.geolocation.clearWatch(watcherId);
      watcherId = null;
      cancelPress(press);
      press = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      map.off("dragstart", onDragStart);
      window.removeEventListener("openmannin:locate", onLocateWindow);
      window.removeEventListener("openmannin:navigate", onNavigateWindow);
      window.removeEventListener("openmannin:nav-mode", onModeWindow);
      window.removeEventListener("openmannin:nav-follow", onFollowWindow);
      window.removeEventListener("openmannin:nav-voice", onVoiceWindow);
      window.removeEventListener("openmannin:clear-nav", onClearWindow);
      window.removeEventListener("openmannin:nav-end", onNavEndEvent);
      window.removeEventListener("openmannin:nav-overview", onNavOverviewEvent);
      window.removeEventListener("openmannin:set-destination", onSetDestinationWindow);
      clearRecalc();
    },
  };
}