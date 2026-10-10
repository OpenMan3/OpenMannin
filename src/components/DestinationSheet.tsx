"use client";

/**
 * Destination sheet: the bottom card that appears when a pin is dropped.
 *
 * It is deliberately a pure view. Every coordinate decision (snapping, nearest
 * place, route computation, marker drawing) belongs to the navigation host; the
 * sheet only renders the state it is given and dispatches one of four window
 * events the host listens for:
 *
 *   openmannin:navigate  - (re)compute the route and fit the map to it
 *   openmannin:nav-mode  - switch the drawn route between walk/drive
 *   openmannin:clear-nav - drop the pin and clear the route
 *
 * "Route" here is the network leg computed on the Isle of Man's road graph,
 * plus the straight connectors to and from the start/end points. The step list
 * is derived from that polyline's bearing changes (see navigation/steps.ts) -
 * geometry, not a street-name oracle, so nothing is invented.
 */

import { useState } from "react";
import { ROUTE_MODES, type RouteMode } from "@/lib/navigation/profiles";
import type { NavigationState } from "@/lib/navigation/host";
import { formatStepDistance, type NavigationStep } from "@/lib/navigation/steps";
import { CarIcon, CloseIcon, ClockIcon, RouteIcon, WalkIcon } from "./Icons";

function formatDistance(m: number): string {
  return formatStepDistance(m);
}

function formatDuration(s: number): string {
  if (s < 45) return "<1 min";
  if (s < 3600) {
    const min = Math.round(s / 60);
    return `${min} min`;
  }
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  return min > 0 ? `${h} h ${min} min` : `${h} h`;
}

/** Local arrival time for a duration in seconds from now. */
function arrivalTime(s: number): string {
  const when = new Date(Date.now() + s * 1000);
  return when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const MODE_ICON: Record<RouteMode, (p: { className?: string }) => React.JSX.Element> = {
  driving: CarIcon,
  walking: WalkIcon,
};

function StepList({ steps }: { steps: NavigationStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-2 space-y-1.5 border-t border-line pt-2">
      {steps.map((step, i) => (
        <li key={`${i}-${step.distanceM}`} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-raised text-[10px] font-semibold text-accent"
          >
            {i + 1}
          </span>
          <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-2">
            {step.instruction}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
            {formatStepDistance(step.distanceM)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DestinationSheet({
  state,
  onToggleMode,
  onNavigate,
  onClear,
}: {
  state: NavigationState;
  onToggleMode: (mode: RouteMode) => void;
  onNavigate: () => void;
  onClear: () => void;
}) {
  const { destination, routes, activeMode, routeStatus, routeError, userLocation, steps } = state;
  const [showSteps, setShowSteps] = useState(false);
  if (!destination) return null;

  const active = routes[activeMode] ?? null;
  const other = ROUTE_MODES.filter((m) => m !== activeMode)[0] ?? null;
  const otherRoute = other ? routes[other] : undefined;

  const busy = routeStatus === "loading";
  const noNetwork = routeStatus === "no-route";
  const failed = routeStatus === "error";
  const ready = routeStatus === "ready" && active;

  const canNavigate = !!userLocation && !busy;

  return (
    <div className="om-sheet-in absolute inset-x-0 bottom-14 z-20 p-3 sm:bottom-3 sm:inset-x-auto sm:right-3 sm:w-[min(24rem,calc(100vw-1.5rem))]">
      <div
        role="dialog"
        aria-label={`Directions to ${destination.title}`}
        className="card overflow-hidden"
      >
        {/* Pin identity */}
        <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-pin uppercase">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full border border-white/80"
              />
              Destination
            </div>
            <div className="truncate text-sm font-semibold text-ink">{destination.title}</div>
            {destination.detail && (
              <div className="truncate text-[11px] text-ink-3">{destination.detail}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear destination"
            className="btn-icon !h-8 !w-8"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1.5 border-b border-line px-3 py-2">
          {ROUTE_MODES.map((mode) => {
            const r = routes[mode];
            const isActive = mode === activeMode;
            const Icon = MODE_ICON[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onToggleMode(mode)}
                aria-pressed={isActive}
                className={`flex flex-1 items-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-accent/12 text-accent ring-1 ring-accent/50"
                    : "text-ink-2 hover:bg-raised hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{mode === "driving" ? "Drive" : "Walk"}</span>
                {r && (
                  <span className="ml-auto shrink-0 text-[10px] font-normal opacity-70">
                    {formatDistance(r.distanceM)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Body: status, then the primary estimate */}
        <div className="px-3 py-2.5">
          {busy && (
            <p className="flex items-center gap-2 text-[12px] italic text-ink-2">
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-accent" />
              Working out the route on the island&apos;s road network…
            </p>
          )}

          {(noNetwork || failed) && routeError && (
            <p className="text-[12px] leading-snug text-warn">{routeError}</p>
          )}

          {!userLocation && routeStatus === "idle" && (
            <p className="text-[12px] leading-snug text-ink-2">
              Press the locate button so a route can be measured from your position. The pin is
              saved meanwhile.
            </p>
          )}

          {userLocation && !active && routeStatus === "idle" && (
            <p className="text-[12px] leading-snug text-ink-2">
              Route not computed yet. Press Navigate to measure it.
            </p>
          )}

          {ready && active && (
            <div className="flex items-end justify-between gap-3">
              <dl className="flex gap-4">
                <div>
                  <dt className="label">
                    {otherRoute !== undefined ? "Route" : "Distance"}
                  </dt>
                  <dd className="text-lg font-semibold text-ink tabular-nums">
                    {formatDistance(active.distanceM)}
                  </dd>
                </div>
                <div>
                  <dt className="label">{otherRoute !== undefined ? "By road" : "Time"}</dt>
                  <dd className="text-lg font-semibold text-ink tabular-nums">
                    {formatDuration(active.durationS)}
                  </dd>
                </div>
              </dl>
              <div className="flex items-center gap-1 text-[11px] text-ink-3">
                <ClockIcon className="h-3.5 w-3.5" />
                arrive {arrivalTime(active.durationS)}
              </div>
            </div>
          )}

          {other && otherRoute !== undefined && ready && (
            <p className="mt-1 truncate text-[11px] text-ink-3">
              {other === "walking" ? "Walking" : "Driving"} alternative:{" "}
              {otherRoute
                ? `${formatDistance(otherRoute.distanceM)} · ${formatDuration(otherRoute.durationS)}`
                : "no road route"}
            </p>
          )}

          {ready && steps.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowSteps((v) => !v)}
                aria-expanded={showSteps}
                className="mt-2 flex w-full items-center justify-between gap-2 border-t border-line pt-2 text-[12px] text-ink-2 hover:text-ink"
              >
                <span className="flex items-center gap-1.5">
                  <RouteIcon className="h-4 w-4 text-accent" />
                  {steps.length} step{steps.length === 1 ? "" : "s"}
                </span>
                <span className="text-[11px] text-ink-3">{showSteps ? "Hide" : "Show"} list</span>
              </button>
              {showSteps && <StepList steps={steps} />}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-line px-3 py-2.5">
          <button
            type="button"
            onClick={onNavigate}
            disabled={!canNavigate}
            className="btn btn-primary flex-1"
          >
            {busy ? "Routing…" : "Navigate"}
          </button>
          <button type="button" onClick={onClear} className="btn">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}