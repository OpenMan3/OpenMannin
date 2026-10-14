"use client";

import { useEffect, useRef } from "react";
import type { NavigationState } from "@/lib/navigation/host";
import { bannerFor, dockFor, hasFix, type NavigationDock } from "@/lib/navigation/hud";
import { ROUTE_MODES, type RouteMode } from "@/lib/navigation/profiles";
import { formatDistance, formatDuration } from "@/lib/units";
import {
  CarIcon,
  BikeIcon,
  WalkIcon,
  CloseIcon,
  CheckIcon,
  ClockIcon,
  ManeuverIcon,
  RouteIcon,
  TurnIcon,
} from "./Icons";

const MODE_ICON: Record<RouteMode, (p: { className?: string }) => React.JSX.Element> = {
  driving: CarIcon,
  cycling: BikeIcon,
  walking: WalkIcon,
};

const MODE_LABEL: Record<RouteMode, string> = {
  driving: "Drive",
  cycling: "Cycle",
  walking: "Walk",
};

interface Props {
  state: NavigationState | null;
  stepsOpen: boolean;
  onToggleSteps: () => void;
  onToggleMode: (mode: RouteMode) => void;
  onNavigate: () => void;
  onEnd: () => void;
  onClear: () => void;
  onOverview: () => void;
  onTopInset?: (px: number) => void;
  onBottomInset?: (px: number) => void;
  minimized: boolean;
}

export function NavigationOverlay(props: Props) {
  const {
    state,
    stepsOpen,
    onToggleSteps,
    onToggleMode,
    onNavigate,
    onEnd,
    onClear,
    onOverview,
    onTopInset,
    onBottomInset,
    minimized,
  } = props;

  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const topCb = useRef(onTopInset);
  const bottomCb = useRef(onBottomInset);
  useEffect(() => { topCb.current = onTopInset; }, [onTopInset]);
  useEffect(() => { bottomCb.current = onBottomInset; }, [onBottomInset]);

  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const report = () => topCb.current?.(Math.max(0, Math.round(el.getBoundingClientRect().height)));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); topCb.current?.(0); };
  }, []);

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const report = () => bottomCb.current?.(Math.max(0, Math.round(el.getBoundingClientRect().height)));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); bottomCb.current?.(0); };
  }, []);

  if (!state?.destination) return null;

  const navig = state.navigating;
  const banner = bannerFor(state, navig);
  const dock = navig ? dockFor(state) : null;
  const arrived = state.routeStatus === "arrived";
  const busy = state.routeStatus === "loading";
  const failed = state.routeStatus === "error" || state.routeStatus === "no-route";
  const routeShown = state.routes[state.activeMode] ?? null;

  // Show mobile collapsed summary if requested
  const showCompact = minimized && routeShown && (!stepsOpen) && !busy && !failed && !arrived;

  return (
    <>
      {navig && banner && banner.visible && (
        <div
          ref={topRef}
          className={[
            "fixed inset-x-4 top-4 z-30 rounded-2xl border px-4 py-4 text-white shadow-[0_8px_24px_rgba(0,0,0,0.25)] sm:left-4 sm:right-auto sm:w-[min(28rem,calc(100vw-2rem))] sm:top-4",
            banner.tone === "ok"
              ? "border-ok/50 bg-ok/95 backdrop-blur"
              : banner.tone === "warn"
                ? "border-warn/50 bg-warn/95 backdrop-blur"
                : banner.tone === "danger"
                  ? "border-danger/50 bg-danger/95 backdrop-blur"
                  : "border-line/50 bg-info/95 backdrop-blur",
          ].join(" ")}
          aria-live={navig ? "polite" : "off"}
          role={navig ? "status" : undefined}
        >
          <div className="flex items-center gap-3">
            <span className="flex shrink-0 items-center justify-center rounded-xl bg-white/20 p-2">
              <ManeuverIcon kind={banner.maneuver} className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide opacity-90">{banner.primary}</div>
              <div className="truncate text-2xl font-semibold tabular-nums">{banner.distanceLabel}</div>
              {banner.instruction && (
                <div className="truncate text-sm opacity-95">{banner.instruction}</div>
              )}
              {banner.nextInstruction && (
                <div className="truncate text-xs opacity-85">{banner.nextInstruction}</div>
              )}
              {banner.streetName && !banner.instruction.toLowerCase().includes(banner.streetName.toLowerCase()) && (
                <div className="truncate text-xs opacity-85">on {banner.streetName}</div>
              )}
            </div>
            {banner.speedLimitMph !== null && (
              <div
                className={[
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-4 bg-white text-sm font-bold",
                  banner.overSpeed ? "border-warn text-warn" : "border-ink text-ink",
                ].join(" ")}
                aria-label={`Speed limit ${banner.speedLimitMph} miles per hour`}
              >
                {banner.speedLimitMph}
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            {state.offRoute && (
              <span className="rounded-full bg-white/20 px-2 py-1 text-[11px] font-semibold">
                {state.routeStatus === "recalculating" ? "recalculating" : "off route"}
              </span>
            )}
            {state.remainingM > 0 && (
              <span className="text-[11px] opacity-90">
                {formatDistance(state.remainingM)} left · {dock ? dock.etaLabel : null}
              </span>
            )}
          </div>
        </div>
      )}

      {!navig && (
        <div ref={bottomRef} className="fixed inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(28rem,calc(100vw-2rem))]">
          <div
            role="dialog"
            aria-label={`Directions to ${state.destination.title}`}
            className="card-floating overflow-hidden"
          >
            <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-pin uppercase">
                  <span className="inline-block h-2 w-2 rounded-full border border-white/80 bg-pin" aria-hidden="true" />
                  Destination
                </div>
                <div className="truncate text-sm font-semibold text-ink">{state.destination.title}</div>
                {state.destination.detail && (
                  <div className="truncate text-[11px] text-ink-3">{state.destination.detail}</div>
                )}
              </div>
              <button type="button" onClick={onClear} aria-label="Clear destination" className="btn-icon !h-8 !w-8">
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-1.5 border-t border-line px-3 py-2">
              {ROUTE_MODES.map((mode) => {
                const r = state.routes[mode];
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onToggleMode(mode)}
                    aria-pressed={mode === state.activeMode}
                    className={[
                      "flex flex-1 items-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium transition-colors",
                      mode === state.activeMode
                        ? "bg-accent/12 text-accent ring-1 ring-accent/50"
                        : "text-ink-2 hover:bg-raised hover:text-ink",
                    ].join(" ")}
                  >
                    {mode === "driving" ? <CarIcon className="h-4 w-4 shrink-0" /> : null}
                    {mode === "cycling" ? <BikeIcon className="h-4 w-4 shrink-0" /> : null}
                    {mode === "walking" ? <WalkIcon className="h-4 w-4 shrink-0" /> : null}
                    <span className="truncate">{MODE_LABEL[mode]}</span>
                    {r && (
                      <span className="ml-auto shrink-0 text-[10px] opacity-70">
                        {formatDistance(r.distanceM)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="px-3 py-2.5">
              {busy && (
                <p className="flex items-center gap-2 text-[12px] italic text-ink-2">
                  <span className="inline-block h-2 w-2 animate-ping rounded-full bg-accent" />
                  Working out the route on the island&apos;s road network…
                </p>
              )}
              {(state.routeStatus === "no-route" || state.routeStatus === "error") && state.routeError && (
                <p className="text-[12px] leading-snug text-warn">{state.routeError}</p>
              )}
              {!hasFix(state) && state.routeStatus === "idle" && (
                <p className="text-[12px] leading-snug text-ink-2">
                  Press locate so a route can be measured from your position. The pin is saved meanwhile.
                </p>
              )}
              {hasFix(state) && !routeShown && state.routeStatus === "idle" && (
                <p className="text-[12px] leading-snug text-ink-2">
                  Press Navigate to measure the route.
                </p>
              )}
              {routeShown && (
                <div className="flex flex-end justify-between gap-3">
                  <dl className="flex gap-4">
                    <div>
                      <dt className="label">{state.progressM > 5 ? "Remaining" : "Distance"}</dt>
                      <dd className="text-lg font-semibold text-ink tabular-nums">
                        {formatDistance(routeShown.distanceM)}
                      </dd>
                    </div>
                    <div>
                      <dt className="label">Time</dt>
                      <dd className="text-lg font-semibold text-ink tabular-nums">
                        {formatDuration(routeShown.durationS)}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex items-center gap-1 text-[11px] text-ink-3">
                    <ClockIcon className="h-3.5 w-3.5" />
                    arrive {formatDuration(routeShown.durationS)}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 border-t border-line px-3 py-2.5">
              <button type="button" onClick={onNavigate} disabled={!hasFix(state) || arrived} className="btn btn-primary flex-1">
                Navigate
              </button>
              <button type="button" onClick={onClear} className="btn">
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {navig && !arrived && showCompact && routeShown && (
        <div
          ref={bottomRef}
          className="fixed inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 rounded-2xl border border-line bg-panel/95 px-3 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.15)] backdrop-blur sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(22rem,calc(100vw-2rem))]"
        >
          <div className="flex flex-1 items-center gap-3 min-w-0">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-ink truncate">{formatDistance(state.remainingM)} left</div>
              <div className="text-[10px] text-ink-3 truncate">{draftLabel(dock, arrived)}</div>
            </div>
          </div>
          <button type="button" onClick={onToggleSteps} className="btn-icon !h-8 !w-8">
            <RouteIcon className="h-4 w-4" />
          </button>
          <button type="button" onClick={onEnd} className="btn !px-3 !py-2 text-xs">
            End
          </button>
        </div>
      )}

      {navig && dock && (
        <div ref={showCompact ? undefined : bottomRef} className={[
          "fixed z-20 w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-panel/95 p-3 shadow-[0_4px_20px_rgba(0,0,0,0.15)] backdrop-blur",
          showCompact ? "hidden" : "inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-4 sm:right-4",
          stepsOpen ? "max-h-[45vh]" : "",
        ].join(" ")}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-[11px] text-ink-2">
              <div className="min-w-[3rem] text-center">
                <div className="text-[10px] text-ink-3">remaining</div>
                <div className="font-semibold tabular-nums text-ink">{formatDistance(state.remainingM)}</div>
              </div>
              <div className="min-w-[3rem] text-center">
                <div className="text-[10px] text-ink-3">ETA</div>
                <div className="font-semibold tabular-nums text-ink">{dock.etaLabel}</div>
              </div>
              {dock.speedLabel && (
                <div className="min-w-[3rem] text-center">
                  <div className="text-[10px] text-ink-3">speed</div>
                  <div className="font-semibold tabular-nums text-ink">{dock.speedLabel}</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {!state.offRoute && (
                <div className="flex gap-1 rounded-lg border border-line-soft bg-raised p-1">
                  {ROUTE_MODES.filter((m) => m !== state.activeMode).map((mode) => {
                    const Icon = MODE_ICON[mode];
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onToggleMode(mode)}
                        className="btn-icon !h-7 !w-7 !border-none !shadow-none text-ink-2 hover:text-ink"
                        title={`Switch to ${MODE_LABEL[mode]}`}
                        aria-label={`Switch to ${MODE_LABEL[mode]}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </button>
                    );
                  })}
                </div>
              )}
              <button
                type="button"
                onClick={onOverview}
                className="btn-icon !h-7 !w-7"
                aria-label="Overview whole route"
              >
                <RouteIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {stepsOpen && (
            <div className="mt-2 max-h-[38vh] overflow-y-auto">
              <ol className="space-y-1.5 border-t border-line pt-2">
                {state.steps.slice(state.stepIndex).map((step, i) => (
                  <li key={`${i}-${step.distanceM}`} className="flex items-start gap-2 text-[12px]">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-raised text-[10px] font-semibold text-accent">
                      {i + state.stepIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-ink-2">{step.instruction}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
                      {formatDistance(step.distanceM)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {state.offRoute && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
              <TurnIcon className="h-4 w-4" />
              {state.routeStatus === "recalculating" ? "Recalculating…" : "Off route—recalculate when convenient"}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onEnd}
              className="btn flex-1 !py-1.5 text-xs"
            >
              End
            </button>
            <button
              type="button"
              onClick={onToggleSteps}
              className="btn flex-1 !py-1.5 text-xs"
            >
              {stepsOpen ? "Hide" : "Steps"}
            </button>
          </div>
        </div>
      )}

      {arrived && (
        <div
          ref={bottomRef}
          className="fixed inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-ok/40 bg-panel shadow-[0_8px_24px_rgba(0,0,0,0.18)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(28rem,calc(100vw-2rem))]"
        >
          <div className="flex items-center gap-3 border-b border-line bg-ok/10 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ok/20 text-ok">
              <CheckIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ok">You’ve arrived</div>
              <div className="truncate text-sm font-semibold text-ink">{state.destination.title}</div>
            </div>
            <button type="button" onClick={onClear} aria-label="Clear destination" className="btn-icon !h-8 !w-8 ml-auto">
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-3 px-4 py-3">
            <p className="flex-1 text-[12px] text-ink-2">
              Within {formatDistance(state.remainingM + 40)} of your destination.
            </p>
            <button type="button" onClick={onClear} className="btn btn-primary !py-1.5">
              Done
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function draftLabel(_dock: NavigationDock | null, arrived: boolean) {
  if (arrived) return "Arrived";
  return "Route active";
}
