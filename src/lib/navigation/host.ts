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
import { deriveSteps, type NavigationStep } from "./steps";

export interface UserLocation {
  lon: number;
  lat: number;
  accuracyM?: number;
  timestamp: number;
}

export interface Destination {
  lon: number;
  lat: number;
  title: string;
  detail: string;
}

export type LocationStatus = "idle" | "locating" | "active" | "error";

export type RouteStatus = "idle" | "loading" | "ready" | "no-route" | "error";

/** What the UI needs to render, without route geometry rattling re-renders. */
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

const LONG_PRESS_MS = 600;
const MAX_DRIFT_PX = 12;
const SNAP_RADIUS_PX = 15;
const SUPPRESS_CLICK_MS = 700;

/** Orange pin colours (#f43f5e is the subsea-cable rose, kept for the pin). */
const PIN_COLOR = "#f43f5e";
const PIN_RING = "rgba(244, 63, 94, 0.22)";
const DOT_COLOR = "#3b82f6";
const DOT_HALO = "#60a5fa";
const ACCURACY_FILL = "rgba(59, 130, 246, 0.12)";
const ACCURACY_STROKE = "rgba(59, 130, 246, 0.35)";
const ROUTE_COLOR = "#35c9d4";

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
  "webcams",
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
};

function initialState(activeMode: RouteMode): Internal {
  return {
    locationStatus: "idle",
    locationError: null,
    userLocation: null,
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
  ]);
}

// ---------------------------------------------------------------------------
// Layer plumbing shared by first-add and style rehydrate
// ---------------------------------------------------------------------------

function ensureGeoJson(
  map: Map,
  id: string,
  data: { type: string; features: unknown[] },
): GeoJSONSource {
  const existing = map.getSource(id);
  if (existing) return existing as GeoJSONSource;
  map.addSource(id, { type: "geojson", data: data as never });
  return map.getSource(id) as GeoJSONSource;
}

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
        "line-color": "#0b0f14",
        "line-opacity": 0.9,
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

  liftNavLayers(map);
}

function emptyCollection(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}

/** Keep markers and the route above every data layer (top = last painted). */
function liftNavLayers(map: Map): void {
  const order = [
    `${SOURCE_ROUTE}-casing`,
    `${SOURCE_ROUTE}-glow`,
    `${SOURCE_ROUTE}-main`,
    `${SOURCE_USER}-accuracy`,
    `${SOURCE_USER}-halo`,
    `${SOURCE_USER}-dot`,
    `${SOURCE_DEST}-ring`,
    `${SOURCE_DEST}-pin`,
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

  const publish = () => {
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
    });
  };

  /** Recompute the displayed legs for whichever route is active right now. */
  const syncSteps = (route?: RouteLeg | null) => {
    state.steps = route && route.coordinates.length > 1 ? deriveSteps(route.coordinates) : [];
  };

  // ---- GPS ---------------------------------------------------------------

  let watcherId: number | null = null;
  let pulseFrame = 0;
  let pulseT = 0;
  /** Bumped per route request; a stale reply from an older pin is discarded. */
  let reqToken = 0;

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

  const onGeolocation = (pos: GeolocationPosition) => {
    const lon = pos.coords.longitude;
    const lat = pos.coords.latitude;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    const loc: UserLocation = {
      lon,
      lat,
      accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : undefined,
      timestamp: pos.timestamp,
    };
    state.userLocation = loc;
    state.locationStatus = "active";
    state.locationError = null;
    setUserData(loc);
    startPulse();

    // First fix after the button press pans to the user; later fixes just move
    // the dot so the map is never yanked away while they are looking.
    if (state.firstFlyPending) {
      state.firstFlyPending = false;
      map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16), duration: 700 });
    }

    if (state.destination && !state.routesFresh) void requestRoutes();
    publish();
  };

  const onGeolocationError = (err: GeolocationPositionError) => {
    const messages: Record<number, string> = {
      1: "Location permission denied. Allow location access to use locate-me.",
      2: "Position unavailable. Check that GPS/location is switched on.",
      3: "Location request timed out. Try again.",
    };
    state.locationStatus = "error";
    state.locationError = messages[err.code] ?? `Location error ${err.code}.`;
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
    publish();
    watcherId = navigator.geolocation.watchPosition(onGeolocation, onGeolocationError, {
      enableHighAccuracy: true,
      maximumAge: 30_000,
      timeout: 25_000,
    });
  };

  const stopLocation = () => {
    if (watcherId !== null) {
      navigator.geolocation.clearWatch(watcherId);
      watcherId = null;
    }
    stopPulse();
    reqToken++;
    state.userLocation = null;
    state.firstFlyPending = false;
    state.routes = {};
    state.steps = [];
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
      padding: { top: 90, bottom: 200, left: 40, right: 40 },
      duration: 700,
      maxZoom: 16,
    });
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
      state.routeError = reply.error ?? "Routing failed.";
      state.routes = {};
      state.steps = [];
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
    if (state.routesFresh) {
      const route = state.routes[mode];
      drawRoute(route);
      syncSteps(route);
    }
    publish();
  };

  const clearDestination = () => {
    reqToken++;
    state.destination = null;
    state.routes = {};
    state.steps = [];
    state.routesFresh = false;
    state.routeStatus = "idle";
    state.routeError = null;
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
    const hits = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], {
      layers: [...SNAP_LAYER_IDS].map((id) => `om-${id}-circle`),
    });

    let best: { d2: number; lon: number; lat: number; props: Record<string, unknown> | null } | null = null;
    for (const hit of hits) {
      const centre = featureCentre(hit.geometry);
      if (!centre) continue;
      const pt = map.project([centre[0], centre[1]]);
      const d2 = (pt.x - x) ** 2 + (pt.y - y) ** 2;
      if (d2 > r * r) continue;
      if (!best || d2 < best.d2) {
        best = { d2, lon: centre[0], lat: centre[1], props: hit.properties };
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
    if (state.userLocation) setUserData(state.userLocation);
    if (state.destination) setDestinationData(state.destination.lon, state.destination.lat);
    const active = state.routes[state.activeMode];
    if (state.routesFresh && active) drawRoute(active);
    liftNavLayers(map);
  };

  const onLocateEvent = () => {
    ensureLayers();
    if (state.locationStatus === "active" && watcherId !== null) {
      // The button toggles: a second press stops the dot.
      stopLocation();
      return;
    }
    startLocation();
  };

  const onNavigateEvent = () => {
    ensureLayers();
    if (!state.destination) return;
    state.fitPending = true;
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

  window.addEventListener("openmannin:locate", onLocateWindow);
  window.addEventListener("openmannin:navigate", onNavigateWindow);
  window.addEventListener("openmannin:nav-mode", onModeWindow);
  window.addEventListener("openmannin:clear-nav", onClearWindow);

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
      if (watcherId !== null) navigator.geolocation.clearWatch(watcherId);
      watcherId = null;
      cancelPress(press);
      press = null;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      window.removeEventListener("openmannin:locate", onLocateWindow);
      window.removeEventListener("openmannin:navigate", onNavigateWindow);
      window.removeEventListener("openmannin:nav-mode", onModeWindow);
      window.removeEventListener("openmannin:clear-nav", onClearWindow);
    },
  };
}