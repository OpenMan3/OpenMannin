"use client";

/**
 * Progress HUD: live driving summary during active navigation.
 *
 * A compact top-left card showing distance remaining, the next maneuver with a
 * live countdown to it, arrival clock time, and live speed. It only exists
 * while the user is actively navigating and has a GPS fix; see no-route /
 * error handling in the destination sheet instead.
 *
 * It is deliberately NOT an aria-live region: the remaining distance and speed
 * change on every GPS fix, so announcing the whole card would flood a screen
 * reader. Spoken guidance (voice.ts) is the accessible channel for turns; this
 * is a glanceable visual aid.
 */

import type { NavigationState } from "@/lib/navigation/host";
import { formatDistance, formatDuration, formatSpeedMph, kmhToMph, mphToKmh } from "@/lib/units";
import { ClockIcon, ManeuverIcon, TurnIcon } from "./Icons";

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
  const { routeStatus, steps, userLocation, remainingM, activeMode, routes, offRoute, speedMph, speedLimitKmh, stepIndex, nextStepM } = state;

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

  // Posted speed limit, shown only for driving and only where OSM tags one.
  // The roundel is red-ringed when the live speed is clearly over it.
  const limitMph = speedLimitKmh !== null ? Math.round(kmhToMph(speedLimitKmh)) : null;
  const showLimit = activeMode === "driving" && limitMph !== null;
  const overLimit = showLimit && speedMph !== null && speedLimitKmh !== null && speedMph > kmhToMph(speedLimitKmh) + 2;

  return (
    <div className="pointer-events-none fixed top-4 left-4 z-20 flex flex-col gap-2 sm:top-auto sm:right-4 sm:bottom-4 sm:left-auto">
      {/* Off-route warning */}
      {offRoute && (
        <div className="flex items-center gap-2 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-2 text-[11px] font-medium text-warn shadow-[0_4px_20px_rgba(0,0,0,0.15)] backdrop-blur">
          <TurnIcon className="h-4 w-4" />
          <span>{routeStatus === "recalculating" ? "Off route — recalculating…" : "Off route — recalculate when convenient"}</span>
        </div>
      )}

      {/* Main progress card */}
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/95 px-4 py-2.5 text-[11px] shadow-[0_4px_20px_rgba(0,0,0,0.15)] backdrop-blur pointer-events-auto">
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
                <ManeuverIcon kind={nextStep.maneuver} className="h-4 w-4 shrink-0 text-accent" />
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

        {/* Posted speed limit (driving only, where OSM tags one) */}
        {showLimit && (
          <>
            <div className="w-px h-8 bg-line" />
            <div
              className={`mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[3px] bg-white text-[13px] font-bold tabular-nums shadow-sm ${
                overLimit ? "border-warn text-warn" : "border-ink text-ink"
              }`}
              title={overLimit ? "Over the posted speed limit" : "Posted speed limit"}
              aria-label={`Speed limit ${limitMph} miles per hour${overLimit ? ", over the limit" : ""}`}
            >
              {limitMph}
            </div>
          </>
        )}
      </div>
    </div>
  );
}