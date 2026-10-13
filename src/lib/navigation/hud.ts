/**
 * Sat-nav guidance view model derived from navigation state.
 *
 * Builds Google-Maps-style banner/dock data that is presentation only.
 */

import type { NavigationState } from "./types";
import type { ManeuverKind, NavigationStep } from "./steps";
import { ROUTE_MODES, type RouteMode } from "./profiles";
import { formatDistance, formatDuration } from "../units";

export type NavSurfaceMode = "none" | "preview" | "prompt" | "guide" | "arrived";

export interface NavigationBanner {
  tone: "neutral" | "info" | "ok" | "warn" | "danger";
  maneuver: ManeuverKind;
  primary: string;
  distanceLabel: string;
  streetName: string | null;
  instruction: string;
  nextInstruction: string | null;
  speed: number | null;
  speedLimitMph: number | null;
  overSpeed: boolean;
  visible: boolean;
}

export interface NavigationDock {
  distanceLabel: string;
  timeLabel: string;
  etaLabel: string;
  modeLabel: string;
  speedLabel: string | null;
  remainingMinutes: number | null;
  offRoute: boolean;
  recalculating: boolean;
}

export interface StepTeaser {
  index: number;
  instruction: string;
  distanceM: number;
  formattedDistance: string;
}

export function surfaceMode(state: NavigationState | null): NavSurfaceMode {
  if (!state?.destination) return "none";
  if (state.routeStatus === "arrived") return "arrived";
  if (!state.navigating) return "preview";
  return "guide";
}

export function currentStep(state: NavigationState | null): NavigationStep | null {
  if (!state || !state.steps.length) return null;
  const index = Math.min(Math.max(0, state.stepIndex), state.steps.length - 1);
  return state.steps[index] ?? null;
}

export function nextStep(state: NavigationState | null): NavigationStep | null {
  if (!state || !state.steps.length) return null;
  const index = Math.min(state.stepIndex + 1, state.steps.length - 1);
  if (index === state.stepIndex || index >= state.steps.length) return null;
  return state.steps[index] ?? null;
}

export function hasFix(state: NavigationState | null): boolean {
  return !!state?.userLocation && state.locationStatus === "active";
}

export function etaMinutes(state: NavigationState | null): number | null {
  if (!state) return null;
  const route = state.routes[state.activeMode];
  if (!route || state.remainingM <= 0) return 0 as number;
  const speedMph = state.speedMph;
  let mps: number | null = null;
  if (speedMph !== null && speedMph > 1.5) {
    mps = speedMph * 0.44704;
  } else if (route.durationS > 0 && route.distanceM > 0) {
    mps = route.distanceM / route.durationS;
  }
  if (mps === null || mps <= 0) return null;
  return (state.remainingM / mps) / 60;
}

export function bannerFor(state: NavigationState | null, navigating: boolean): NavigationBanner | null {
  if (!state?.destination) return null;
  const step = currentStep(state);
  const nxt = nextStep(state);
  const speedLimitMph = state.speedLimitKmh === null ? null : Math.round(state.speedLimitKmh * 0.621371192);
  const showLimit = state.activeMode === "driving" && speedLimitMph !== null;
  const overSpeed = showLimit
    && state.speedMph !== null
    && speedLimitMph !== null
    && state.speedMph > speedLimitMph + 2;

  const fullInstruction = step ? step.instruction : "Head out";
  const previewTitle = state.destination.title || "Pinned location";
  const previewPrimary = state.destination.title ? "Start there" : "Navigate";

  let tone: NavigationBanner["tone"] = "info";
  let primary: string;
  let instruction = fullInstruction;
  let visible = true;

  if (!navigating) {
    visible = false;
    primary = previewPrimary;
    instruction = previewTitle;
  } else {
    switch (state.routeStatus) {
      case "no-route":
        tone = "warn";
        primary = "No route";
        instruction = state.routeError ?? "No route could be measured";
        break;
      case "error":
        tone = "danger";
        primary = "Routing failed";
        instruction = state.routeError ?? "The route request failed";
        break;
      case "loading":
        tone = "neutral";
        primary = "Planning";
        instruction = instruction || "Working out the route on the island's road network…";
        break;
      case "arrived":
        tone = "ok";
        primary = "Arrived";
        instruction = previewTitle;
        break;
      default:
        if (state.offRoute) {
          tone = "warn";
          primary = state.routeStatus === "recalculating"
            ? "Off route—recalculating…"
            : "Off route—recalc when convenient";
          instruction = fullInstruction;
        } else if (step?.maneuver === "depart") {
          primary = fullInstruction.replace(/\s+on\s+.+$/i, "") || "Head out";
        } else {
          primary = fullInstruction.replace(/\s+on\s+.+$/i, "") || "Continue";
        }
        break;
    }
  }

  const primaryForBanner = primary.length ? primary : fullInstruction;
  const distanceM = state.nextStepM > 0 ? state.nextStepM : step?.distanceM ?? 0;

  return {
    tone,
    maneuver: step?.maneuver ?? "continue",
    primary: primaryForBanner,
    distanceLabel: `${formatDistance(distanceM)} ahead`,
    streetName: step?.streetName ?? null,
    instruction,
    nextInstruction: nxt ? `Then: ${nxt.instruction}` : null,
    speed: state.speedMph,
    speedLimitMph: showLimit ? speedLimitMph : null,
    overSpeed,
    visible,
  };
}

export function dockFor(state: NavigationState | null): NavigationDock | null {
  if (!state?.destination) return null;
  const route = state.routes[state.activeMode];
  const modeLabel = ROUTE_MODES.includes(state.activeMode as RouteMode) ? state.activeMode : "driving";
  const mins = etaMinutes(state);
  const speedLabel = state.speedMph !== null && state.speedMph > 0 ? `${Math.round(state.speedMph)} mph` : null;
  return {
    distanceLabel: formatDistance(state.remainingM || (route?.distanceM ?? 0)),
    timeLabel: formatDuration(route?.durationS ?? 0),
    etaLabel: state.remainingM <= 0 ? "Arrived" : `${Math.round(mins ?? 0) || 0} min`,
    modeLabel,
    speedLabel,
    remainingMinutes: mins,
    offRoute: state.offRoute,
    recalculating: state.routeStatus === "recalculating",
  };
}

export function stepsTeaser(state: NavigationState | null, open: boolean): StepTeaser[] {
  if (!state || !open) return [];
  return state.steps.map((step, i) => ({
    index: i,
    instruction: step.instruction,
    distanceM: step.distanceM,
    formattedDistance: formatDistance(step.distanceM),
  }));
}
