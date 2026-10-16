"use client";

/**
 * Collapsed satellite-pass widget for the map overlay.
 *
 * WHY IT OWNS ITS OWN FETCH. The parent mounts it and forgets it: no props, no
 * state lifted, no coupling to the map layer's own poll. `fetchPasses` caches
 * per station in localStorage, so a second caller is a cache hit rather than a
 * second worker run - this widget and the live layer can share one computation
 * without either owning the other's lifecycle.
 *
 * TWO CLOCKS, ON PURPOSE. The countdown ("in 42 min") is wrong the longer the
 * card sits open, so a 30 s tick re-renders it; the data itself drifts far more
 * slowly, so `fetchPasses` is re-called every 10 minutes at most. The 30 s
 * timer must be cleared on unmount - a leaked interval here keeps a detached
 * component re-rendering forever.
 *
 * NEVER BLOCKS, NEVER CRASHES. A failed feed renders one quiet line, a stale
 * cache renders with a "cached" note, and an empty collection says so. None of
 * these are errors the user must act on; the map works with the widget dead.
 */

import { useEffect, useState } from "react";
import { fetchPasses } from "@/lib/feeds/passes-client";
import { clockOf, nextPassLabel, stationOf, summarizePasses } from "@/lib/feeds/pass-summary";
import { formatDuration } from "@/lib/units";

/** Re-render the countdown. A pass time moves a minute; this keeps up. */
const TICK_MS = 30_000;
/** Re-fetch at most this often. The client has its own cache, so this is cheap. */
const REFRESH_MS = 10 * 60_000;

/** Local satellite glyph. Icons.tsx is shared; this is the only place it is needed. */
function SatelliteGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.8 14.2l4.4-4.4 2.6 2.6-4.4 4.4z" />
        <path d="M5.8 10.8l2.8-2.8 4 4-2.8 2.8z" />
        <path d="M13.2 5.4l2.8-2.8 4 4-2.8 2.8z" />
        <path d="M10.6 17.6c-.6 1-1 1.8-1.2 2.8" />
        <path d="M13.8 18.4a5 5 0 0 0 1.6-2.2" />
      </g>
    </svg>
  );
}

export function PassWidget({ className }: { className?: string }) {
  const [fc, setFc] = useState<unknown>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  /** Bumped by the 30 s tick; forces the countdown to recompute `now`. */
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchPasses("spaceman")
        .then((r) => {
          if (cancelled) return;
          setFc(r.fc ?? null);
          setStale(!!r.stale);
          setFailed(!r.fc && !!r.failure);
          setLoading(false);
        })
        .catch(() => {
          // fetchPasses is written not to throw, but a dead worker or a
          // rejected cache read still must not take the widget down.
          if (cancelled) return;
          setFailed(true);
          setLoading(false);
        });
    };

    load();
    const refresh = setInterval(load, REFRESH_MS);
    const countdown = setInterval(() => setTick((t) => t + 1), TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(refresh);
      clearInterval(countdown);
    };
  }, []);

  if (failed) {
    return (
      <div className={className}>
        <div className="rounded-full border border-line bg-panel/95 px-2.5 py-1 text-[11px] text-ink-3 shadow-lg backdrop-blur">
          Satellite passes unavailable
        </div>
      </div>
    );
  }

  if (loading && !fc) {
    return (
      <div className={className}>
        <div className="rounded-full border border-line bg-panel/95 px-2.5 py-1 text-[11px] text-ink-3 shadow-lg backdrop-blur">
          Loading passes…
        </div>
      </div>
    );
  }

  const now = Date.now();
  const summaries = summarizePasses(fc, now);
  const label = nextPassLabel(summaries, now) ?? "No passes soon";
  const station = stationOf(fc);

  const staleNote = stale ? (
    <span className="shrink-0 text-[10px] font-semibold text-warn">cached</span>
  ) : null;

  if (!open) {
    return (
      <div className={className}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          title="Satellite passes"
          className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-panel/95 px-2.5 py-1 text-[11px] font-medium text-ink-2 shadow-lg backdrop-blur transition-colors hover:bg-raised hover:text-ink"
        >
          <SatelliteGlyph className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate tabular-nums">{label}</span>
          {staleNote}
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="card-floating w-[min(20rem,calc(100vw-2rem))] overflow-hidden border border-line-soft">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded={true}
          title="Satellite passes"
          className="flex w-full items-center gap-2 border-b border-line-soft px-3 py-2 text-left"
        >
          <SatelliteGlyph className="h-4 w-4 shrink-0 text-ink-2" />
          <span className="label flex-1">Satellite passes</span>
          {staleNote}
        </button>

        {summaries.length === 0 ? (
          <p className="px-3 py-2 text-[12px] leading-snug text-ink-3">
            Nothing predicted overhead in the next 48 hours.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {summaries.map((s) => (
              <li
                key={`${s.noradId}-${s.rise}`}
                className="flex items-baseline gap-2 px-3 py-1.5 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{s.name}</span>
                <span className="shrink-0 tabular-nums text-ink-2">
                  {clockOf(s.rise)}–{clockOf(s.set)}
                </span>
                <span className="shrink-0 tabular-nums text-ink-3">{formatDuration(s.durationS)}</span>
                <span className="w-8 shrink-0 text-right tabular-nums text-ink-2">
                  {Math.round(s.maxElevDeg)}°
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="truncate border-t border-line-soft px-3 py-1.5 text-[10px] text-ink-3">
          {station ? `${station} · ` : ""}predicted, not observed
        </div>
      </div>
    </div>
  );
}
