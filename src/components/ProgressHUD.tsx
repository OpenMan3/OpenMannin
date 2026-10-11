"use client";

/**
 * Progress HUD: shows distance remaining, next turn, and ETA during active navigation.
 *
 * Appears when a route is ready and the user has a GPS fix. Compact overlay
 * that doesn't interfere with the map or destination sheet.
 */

import type { NavigationState } from "@/lib/navigation/host";
import { formatDistance, formatDuration, formatSpeedMph, kmhToMph } from "@/lib/units";
import { ClockIcon, TurnIcon } from "./Icons";

interface ProgressHUDProps {
  state: NavigationState;
}

export function ProgressHUD({ state }: ProgressHUDProps) {
  const { routeStatus, steps, userLocation, remainingM, progressM, activeMode, routes, offRoute } = state;

  // Only show when actively navigating with a route
  if (routeStatus !== "ready" && routeStatus !== "recalculating" || !userLocation || !steps.length) {
    return null;
  }

  const activeRoute = routes[activeMode];
  if (!activeRoute) return null;

  const nextStep = steps[0];
  const nextNextStep = steps[1];
  const totalDistanceM = activeRoute.distanceM;
  const totalDurationS = activeRoute.durationS;

  // Estimate current speed from progress (rough)
  const currentSpeedKmh = progressM > 100 ? kmhToMph(totalDistanceM / (totalDurationS / 3600)) : 0;

  return (
    <div
      className="absolute top-[80px] right-3 z-20 flex flex-col gap-2 pointer-events-none md:top-[100px]"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* Off-route warning */}
      {offRoute && routeStatus === "recalculating" && (
        <div className="flex items-center gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-[11px] font-medium text-warn shadow-lg backdrop-blur">
          <TurnIcon className="h-4 w-4" />
          <span>Off route — recalculating…</span>
        </div>
      )}

      {/* Main progress card */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-page/95 px-3 py-2.5 text-[11px] shadow-lg backdrop-blur pointer-events-auto">
        {/* Distance remaining */}
        <div className="flex flex-col items-end min-w-[4.5rem]">
          <span className="text-ink-3">remaining</span>
          <span className="font-semibold text-ink tabular-nums">{formatDistance(remainingM)}</span>
        </div>

        <div className="w-px h-8 bg-line" />

        {/* Next turn */}
        <div className="flex flex-col min-w-0">
          {nextStep && (
            <>
              <div className="flex items-center gap-1.5">
                <TurnIcon className="h-3.5 w-3.5 text-accent" />
                <span className="truncate text-ink-3">{nextStep.instruction}</span>
              </div>
              <div className="flex items-center gap-1 pl-5 text-[10px] text-ink-3">
                <span className="tabular-nums">{formatDistance(nextStep.distanceM)}</span>
              </div>
            </>
          )}
        </div>

        <div className="w-px h-8 bg-line" />

        {/* ETA & speed */}
        <div className="flex flex-col items-start min-w-[4rem]">
          <div className="flex items-center gap-1 text-ink-3">
            <ClockIcon className="h-3.5 w-3.5" />
            <span>{formatDuration(totalDurationS)}</span>
          </div>
          {currentSpeedKmh > 0 && (
            <span className="text-[10px] text-ink-3">{formatSpeedMph(currentSpeedKmh)}</span>
          )}
        </div>
      </div>

      {/* Next-next step preview (small) */}
      {nextNextStep && (
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-page/80 px-2 py-1 text-[10px] text-ink-3 shadow-sm backdrop-blur">
          <TurnIcon className="h-3 w-3 text-ink-3" />
          <span className="truncate max-w-[12rem]">then {nextNextStep.instruction.toLowerCase()}</span>
          <span className="tabular-nums opacity-70">{formatDistance(nextNextStep.distanceM)}</span>
        </div>
      )}
    </div>
  );
}