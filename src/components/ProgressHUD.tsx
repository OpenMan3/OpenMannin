"use client";

/**
 * Progress HUD: live driving summary during active navigation.
 *
 * A compact top-right card showing distance remaining, the next maneuver with
 * a live countdown to it, arrival clock time, and live speed. It only exists
 * while the user is actively navigating and has a GPS fix; see no-route /
 * error handling in the destination sheet instead.
 */

import type { NavigationState } from "@/lib/navigation/host";
import { formatDistance, formatDuration, formatSpeedMph, mphToKmh } from "@/lib/units";
import { ClockIcon, TurnIcon } from "./Icons";

interface ProgressHUDProps {
  state: NavigationState;
}

function arrivalEstimate(state: NavigationState): {
  remainingS: number | null;
  clockHhmm: string;
} {
  const { remainingM, routeStatus, activeMode, routes, speedMph } = state;
  const route = routes[activeMode];

  if (!route || routeStatus === "arrived" || remainingM <= 0) {
    return { remainingS: 0, clockHhmm: "" };
  }

  // Prefer live speed; fall back to the route's own average for the mode.
  let mps: number | null = null;
  if (speedMph !== null && speedMph > 1.5) {
    mps = speedMph * 0.44704;
  } else if (route.durationS > 0 && route.distanceM > 0) {
    mps = route.distanceM / route.durationS;
  }
  const remainingS = mps ? remainingM / mps : null;
  const clock = new Date(Date.now() + (remainingS ?? remainingM / 1.34) * 1000);
  return { remainingS, clockHhmm: clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
}

export function ProgressHUD({ state }: ProgressHUDProps) {
  const { routeStatus, steps, userLocation, remainingM, activeMode, routes, offRoute, speedMph, stepIndex, nextStepM } = state;

  const active = routeStatus === "ready" || routeStatus === "recalculating" || routeStatus === "arrived";
  if (!active || !userLocation || !steps.length || routeStatus === "arrived") {
    return null;
  }

  const activeRoute = routes[activeMode];
  if (!activeRoute) return null;

  const nextStep = steps[Math.min(stepIndex, steps.length - 1)];
  const nextNextStep = steps[Math.min(stepIndex + 1, steps.length - 1)];
  const showNext = stepIndex < steps.length;
  const { remainingS, clockHhmm } = arrivalEstimate(state);

  return (
    <div
      className="absolute top-4 left-4 z-20 flex flex-col gap-2 pointer-events-none md:left-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Off-route warning */}
      {offRoute && (
        <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1.5 text-[11px] font-medium text-warn shadow-md backdrop-blur">
          <TurnIcon className="h-4 w-4" />
          <span>{routeStatus === "recalculating" ? "Off route — recalculating…" : "Off route — recalculate when convenient"}</span>
        </div>
      )}

      {/* Main progress card */}
      <div className="flex items-center gap-3 rounded-full border border-line bg-panel/95 pl-4 pr-2 py-2 text-[11px] shadow-lg backdrop-blur pointer-events-auto">
        {/* Distance remaining */}
        <div className="flex flex-col items-end min-w-[4rem]">
          <span className="text-ink-3">remaining</span>
          <span className="font-semibold text-ink tabular-nums">{formatDistance(remainingM)}</span>
        </div>

        <div className="w-px h-8 bg-line" />

        {/* Next turn */}
        <div className="flex flex-col min-w-0">
          {showNext && nextStep ? (
            <>
              <div className="flex items-center gap-1.5">
                <TurnIcon className="h-3.5 w-3.5 text-accent" />
                <span className="truncate text-ink">{nextStep.instruction}</span>
              </div>
              <div className="flex items-center gap-1 pl-5 text-[10px] text-ink-3">
                <span className="tabular-nums">{formatDistance(nextStepM)}</span>
                <span className="opacity-70">· then {nextNextStep?.instruction.toLowerCase() ?? "arrival"}</span>
              </div>
            </>
          ) : (
            <div className="text-ink-3">Arriving</div>
          )}
        </div>

        <div className="w-px h-8 bg-line" />

        {/* ETA & speed */}
        <div className="flex flex-col items-start min-w-[4.5rem]">
          <div className="flex items-center gap-1 text-ink-3">
            <ClockIcon className="h-3.5 w-3.5" />
            <span>{clockHhmm}</span>
          </div>
          {remainingS !== null ? (
            <span className="tabular-nums text-[10px] text-ink-3">{formatDuration(remainingS)} left</span>
          ) : (
            <span className="text-[10px] text-ink-3">ETA unknown</span>
          )}
          {speedMph !== null && (
            <span className="text-[10px] text-ink-3">{formatSpeedMph(mphToKmh(speedMph))}</span>
          )}
        </div>
      </div>
    </div>
  );
}