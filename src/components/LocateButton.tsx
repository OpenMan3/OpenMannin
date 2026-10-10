"use client";

/**
 * Locate-me control, docked under the MapLibre zoom/compass group.
 *
 * The button is a dumb peer of the navigation host: it only toggles the watch
 * and reflects the status it is handed. All geolocation, the blue-dot marker
 * and its animation live in host.ts - this component just owns a square button
 * and three states (idle, locating, live).
 *
 * Sitting ~2px lower than stock MapLibre controls so it does not collide with
 * the zoom group directly above it.
 */

import type { NavigationState, LocationStatus } from "@/lib/navigation/host";

function CrosshairIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 2.5v3.4M12 18.1v3.4M2.5 12h3.4M18.1 12h3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    </svg>
  );
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="7.5" stroke="#3b82f6" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="11" stroke="#60a5fa" strokeWidth="1.4" strokeDasharray="3 5" />
      <circle cx="12" cy="12" r="3" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="#3b82f6" strokeOpacity="0.3" strokeWidth="2.4" />
      <path d="M20 12 a8 8 0 0 0 -8 -8" fill="none" stroke="#3b82f6" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function LocateButton({ state, onToggle }: { state: NavigationState; onToggle: () => void }) {
  const { locationStatus } = state;
  const labels: Record<LocationStatus, string> = {
    idle: "Show my location",
    locating: "Locating…",
    active: "Stop showing my location",
    error: state.locationError ? `Location error: ${state.locationError}` : "Smag: location failed",
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={labels[locationStatus]}
      title={labels[locationStatus]}
      className={`btn-icon absolute top-[150px] right-3 z-10 md:top-[74px] ${
        locationStatus === "active"
          ? "ring-2 ring-gps/50"
          : locationStatus === "error"
            ? "ring-1 ring-warn/60"
            : ""
      }`}
    >
      {locationStatus === "locating" ? (
        <SpinnerIcon />
      ) : locationStatus === "active" ? (
        <LocateIcon />
      ) : (
        <CrosshairIcon />
      )}
    </button>
  );
}