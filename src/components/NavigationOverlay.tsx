"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearRecent,
  destKey,
  formatCoordPair,
  isSaved,
  loadRecent,
  loadSaved,
  recordRecent,
  relativeWhen,
  saveDest,
  unsaveDest,
  type StoredDestination,
} from "@/lib/destinations";
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

  const topCb = useRef(onTopInset);
  const bottomCb = useRef(onBottomInset);
  useEffect(() => { topCb.current = onTopInset; }, [onTopInset]);
  useEffect(() => { bottomCb.current = onBottomInset; }, [onBottomInset]);

  // Measure the live insets with callback refs. The banner (top) and the
  // destination card (bottom) mount conditionally, so the old mount-only
  // effects ran while both were absent and never re-ran: the map padding
  // stayed at 0 and the route sat under the sheet on every session. Several
  // bottom cards can overlap (a finished route renders both the arrived card
  // and the idle preview), so each carries a keyed ref and the reported inset
  // is the tallest mounted card.
  const topRo = useRef<ResizeObserver | null>(null);
  const topRef = useCallback((el: HTMLDivElement | null) => {
    topRo.current?.disconnect();
    topRo.current = null;
    if (!el) {
      topCb.current?.(0);
      return;
    }
    const report = () =>
      topCb.current?.(Math.max(0, Math.round(el.getBoundingClientRect().height)));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    topRo.current = ro;
  }, []);

  const bottomEls = useRef(new Map<string, HTMLDivElement>());
  const bottomRo = useRef<ResizeObserver | null>(null);
  const reportBottom = useCallback(() => {
    let h = 0;
    bottomEls.current.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) h = Math.max(h, rect.height);
    });
    bottomCb.current?.(Math.max(0, Math.round(h)));
  }, []);
  const bottomRefs = useMemo(() => {
    const getRo = () => {
      if (!bottomRo.current) {
        bottomRo.current = new ResizeObserver(() => reportBottom());
      }
      return bottomRo.current;
    };
    const make = (role: string) => (el: HTMLDivElement | null) => {
      const els = bottomEls.current;
      const prev = els.get(role);
      if (prev && prev !== el) getRo().unobserve(prev);
      if (el) {
        els.set(role, el);
        getRo().observe(el);
      } else {
        els.delete(role);
      }
      reportBottom();
    };
    return {
      preview: make("preview"),
      compact: make("compact"),
      dock: make("dock"),
      arrived: make("arrived"),
    };
  }, [reportBottom]);

  useEffect(
    () => () => {
      topRo.current?.disconnect();
      bottomRo.current?.disconnect();
    },
    [],
  );

  // ---- Saved & recent destinations ----------------------------------------
  // Loaded once after mount: SSR renders this overlay too, so the first paint
  // must not depend on storage being readable.
  const [recent, setRecent] = useState<StoredDestination[]>([]);
  const [saved, setSaved] = useState<StoredDestination[]>([]);
  /** The "Recent & saved" section opens itself only when it has content. */
  const [listsOpen, setListsOpen] = useState(false);

  useEffect(() => {
    const storedRecent = loadRecent();
    const storedSaved = loadSaved();
    setRecent(storedRecent);
    setSaved(storedSaved);
    if (storedRecent.length > 0 || storedSaved.length > 0) setListsOpen(true);
  }, []);

  // Hoisted so the recording effect can depend on it directly - the host
  // republishes the whole state object on every GPS tick, not just the pin.
  const destination = state?.destination;

  // Record each destination as it is opened. The pin is compared against the
  // one recorded last: republished state must not rewrite the list once a
  // second while a route is being tracked.
  const lastRecorded = useRef<{ lon: number; lat: number } | null>(null);
  useEffect(() => {
    if (!destination) {
      lastRecorded.current = null; // a cleared pin: the next one is fresh activity
      return;
    }
    const last = lastRecorded.current;
    if (last && Math.abs(last.lon - destination.lon) < 1e-6 && Math.abs(last.lat - destination.lat) < 1e-6) {
      return;
    }
    lastRecorded.current = { lon: destination.lon, lat: destination.lat };
    setRecent(recordRecent(destination));
  }, [destination]);

  if (!destination) return null;

  const navig = state.navigating;
  const banner = bannerFor(state, navig);
  const dock = navig ? dockFor(state) : null;
  const arrived = state.routeStatus === "arrived";
  const busy = state.routeStatus === "loading";
  const failed = state.routeStatus === "error" || state.routeStatus === "no-route";
  const routeShown = state.routes[state.activeMode] ?? null;

  // Show mobile collapsed summary if requested
  const showCompact = minimized && routeShown && (!stepsOpen) && !busy && !failed && !arrived;

  // ---- Recent & saved list -------------------------------------------------
  // Recents lead (newest first); saved places that have aged out of the recent
  // window follow, so a favourite older than the recent cap stays reachable.
  const recentKeys = new Set(recent.map(destKey));
  const rows = [...recent, ...saved.filter((d) => !recentKeys.has(destKey(d)))];
  const savedKeys = new Set(saved.map(destKey));
  const currentSaved = isSaved(destination);

  const goToDestination = (d: StoredDestination) => {
    // Re-record here as well as dispatching: the recording effect skips a pin
    // that has not moved, so tapping the top row would otherwise leave the
    // list unrefreshed.
    setRecent(recordRecent(d));
    window.dispatchEvent(
      new CustomEvent("openmannin:set-destination", {
        detail: { lon: d.lon, lat: d.lat, title: d.title, detail: d.detail ?? "" },
      }),
    );
  };

  const toggleSaved = (d: StoredDestination) => {
    setSaved(savedKeys.has(destKey(d)) ? unsaveDest(d) : saveDest(d));
  };

  const toggleCurrentSaved = () => {
    setSaved(currentSaved ? unsaveDest(destination) : saveDest(destination));
  };

  const clearRecents = () => {
    clearRecent();
    setRecent([]);
  };

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
        <div ref={bottomRefs.preview} className="fixed inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(28rem,calc(100vw-2rem))]">
          <div
            role="dialog"
            aria-label={`Directions to ${destination.title}`}
            className="card-floating overflow-hidden"
          >
            <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-pin uppercase">
                  <span className="inline-block h-2 w-2 rounded-full border border-white/80 bg-pin" aria-hidden="true" />
                  Destination
                </div>
                <div className="truncate text-sm font-semibold text-ink">{destination.title}</div>
                {destination.detail && (
                  <div className="truncate text-[11px] text-ink-3">{destination.detail}</div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={toggleCurrentSaved}
                  aria-pressed={currentSaved}
                  aria-label={currentSaved ? "Remove destination from saved" : "Save destination"}
                  className="btn-icon !h-8 !w-8"
                >
                  <StarIcon className="h-4 w-4" filled={currentSaved} />
                </button>
                <button type="button" onClick={onClear} aria-label="Clear destination" className="btn-icon !h-8 !w-8">
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-t border-line-soft px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setListsOpen((open) => !open)}
                  aria-expanded={listsOpen}
                  className="label flex items-center gap-1 rounded px-1 py-0.5 hover:text-ink-2"
                >
                  <ChevronIcon className="h-3 w-3" open={listsOpen} />
                  Recent &amp; saved
                </button>
                {recent.length > 0 && (
                  <button
                    type="button"
                    onClick={clearRecents}
                    className="rounded px-1 py-0.5 text-[10px] font-medium text-ink-3 hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
              {listsOpen && rows.length === 0 && (
                <p className="mt-1 text-[11px] text-ink-3">No destinations yet.</p>
              )}
              {listsOpen && rows.length > 0 && (
                <ul className="scroll-thin mt-1 max-h-40 divide-y divide-line-soft overflow-y-auto">
                  {rows.map((d) => {
                    const key = destKey(d);
                    const marked = savedKeys.has(key);
                    return (
                      <li key={key} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => goToDestination(d)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-raised"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-medium text-ink">{d.title}</span>
                            <span className="block truncate text-[10px] tabular-nums text-ink-3">
                              {formatCoordPair(d.lon, d.lat)}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] text-ink-3">{relativeWhen(d.at)}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSaved(d)}
                          aria-pressed={marked}
                          aria-label={marked ? `Remove ${d.title} from saved` : `Save ${d.title}`}
                          className="btn-icon !h-7 !w-7 !border-none !shadow-none"
                        >
                          <StarIcon className="h-3.5 w-3.5" filled={marked} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
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
          ref={bottomRefs.compact}
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
        <div ref={showCompact ? undefined : bottomRefs.dock} className={[
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
          ref={bottomRefs.arrived}
          className="fixed inset-x-4 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-ok/40 bg-panel shadow-[0_8px_24px_rgba(0,0,0,0.18)] sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[min(28rem,calc(100vw-2rem))]"
        >
          <div className="flex items-center gap-3 border-b border-line bg-ok/10 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ok/20 text-ok">
              <CheckIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ok">You’ve arrived</div>
              <div className="truncate text-sm font-semibold text-ink">{destination.title}</div>
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

/**
 * Star for the saved state, defined here rather than in Icons.tsx because
 * nothing outside this card uses it. `filled` swaps the outline for a solid
 * glyph so the pressed state needs no colour of its own.
 */
function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      className={className}
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M12 3.6L14.1 9.1L20 9.4L15.4 13.1L16.9 18.8L12 15.6L7.1 18.8L8.6 13.1L4 9.4L9.9 9.1Z" />
    </svg>
  );
}

/** Chevron for the "Recent & saved" toggle: up while open, down while shut. */
function ChevronIcon({ className, open }: { className?: string; open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}
