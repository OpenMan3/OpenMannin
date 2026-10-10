"use client";

/**
 * Locate-me control, docked under the MapLibre zoom/compass group.
 *
 * The button is a dumb peer of the navigation host: it only toggles the watch
 * and reflects the status it is handed. All geolocation, the blue-dot marker
 * and its animation live in host.ts - this component just owns a square button
 * and the three visual states a GPS control needs:
 *
 *   idle      - crosshair, neutral. The first press asks for a fix.
 *   searching - spinner on a blue-tinted button, while the first fix is owed.
 *   active    - filled dot + soft pulsing halo on a stronger blue fill, and
 *               the click becomes "stop tracking" (or "Recenter" when the map
 *               has been dragged away from the dot).
 *
 * When live tracking is on but the map was dragged away, the host raises
 * `recenterPending` and this control stacks a small clickable "Recenter" pill
 * above the button - same event as the button, so either press flies back.
 */

import type { NavigationState, LocationStatus } from "@/lib/navigation/host";
import { CrosshairIcon } from "./Icons";

const STATE_CLASS: Record<LocationStatus, string> = {
  idle: "text-ink-2",
  locating: "bg-gps/10 text-gps-soft ring-2 ring-gps/40",
  active: "bg-gps/15 text-gps-soft ring-2 ring-gps/60",
  error: "text-warn ring-1 ring-warn/60",
};

function CrosshairGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.5v3.4M12 18.1v3.4M2.5 12h3.4M18.1 12h3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

function LocateGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="7.5" stroke="#3b82f6" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="11" stroke="#60a5fa" strokeWidth="1.4" strokeDasharray="3 5" />
      <circle cx="12" cy="12" r="3" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.4" />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="#3b82f6" strokeOpacity="0.3" strokeWidth="2.4" />
      <path d="M20 12 a8 8 0 0 0 -8 -8" fill="none" stroke="#3b82f6" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function LocateButton({ state, onToggle }: { state: NavigationState; onToggle: () => void }) {
  const { locationStatus, recenterPending } = state;

  const labels: Record<LocationStatus, string> = {
    idle: "Show my location",
    locating: "Locating…",
    active: recenterPending
      ? "Recenter on my location"
      : "Stop showing my location",
    error: state.locationError ? `Location error: ${state.locationError}` : "Location failed",
  };

  return (
    <div className="absolute top-[150px] right-3 z-10 flex flex-col items-end gap-2 md:top-[74px]">
      {locationStatus === "active" && recenterPending && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Recenter on my location"
          title="Recenter on my location"
          className="flex items-center gap-1.5 rounded-full border border-line bg-page/95 px-2.5 py-1 text-[11px] font-medium text-gps-soft shadow-lg backdrop-blur transition-colors hover:bg-raised hover:text-gps"
        >
          <CrosshairIcon className="h-3.5 w-3.5" />
          Recenter
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-label={labels[locationStatus]}
        title={labels[locationStatus]}
        className={`btn-icon relative overflow-visible transition-colors ${STATE_CLASS[locationStatus]}`}
      >
        {locationStatus === "active" && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 animate-pulse rounded-md bg-gps/25"
          />
        )}
        <span className="relative">
          {locationStatus === "locating" ? (
            <SpinnerGlyph />
          ) : locationStatus === "active" ? (
            <LocateGlyph />
          ) : (
            <CrosshairGlyph />
          )}
        </span>
      </button>
    </div>
  );
}