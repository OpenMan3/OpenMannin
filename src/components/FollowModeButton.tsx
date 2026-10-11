"use client";

import type { FollowMode } from "@/lib/navigation/host";
import { CrosshairIcon } from "./Icons";

const FOLLOW_TITLES: Record<FollowMode, string> = {
  none: "Camera follow: off",
  follow: "Camera follow: on (tap for heading-up)",
  heading: "Camera follow: heading-up (tap to disable)",
};

const FOLLOW_CLASSES: Record<FollowMode, string> = {
  none: "text-ink-2",
  follow: "bg-gps/10 text-gps-soft ring-1 ring-gps/40",
  heading: "bg-gps/15 text-gps-soft ring-2 ring-gps/60",
};

function FollowGlyph({ mode }: { mode: FollowMode }) {
  if (mode === "heading") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="7.5" stroke="#3b82f6" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="11" stroke="#60a5fa" strokeWidth="1.4" strokeDasharray="3 5" />
        <path d="M12 4v6M12 10l3 3" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" fill="none" />
        <circle cx="12" cy="12" r="3" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.4" />
      </svg>
    );
  }
  if (mode === "follow") {
    return (
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="7.5" stroke="#3b82f6" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="11" stroke="#60a5fa" strokeWidth="1.4" strokeDasharray="3 5" />
        <circle cx="12" cy="12" r="3" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.4" />
      </svg>
    );
  }
  return <CrosshairIcon className="h-5 w-5" />;
}

export function FollowModeButton({
  followMode,
  onToggle,
}: {
  followMode: FollowMode;
  onToggle: (mode: FollowMode) => void;
}) {
  const modes: FollowMode[] = ["none", "follow", "heading"];
  const currentIndex = modes.indexOf(followMode);
  const nextMode = modes[(currentIndex + 1) % modes.length];

  return (
    <button
      type="button"
      onClick={() => onToggle(nextMode)}
      aria-label={FOLLOW_TITLES[followMode]}
      title={FOLLOW_TITLES[followMode]}
      className={`btn-icon relative transition-colors ${FOLLOW_CLASSES[followMode]}`}
    >
      {followMode !== "none" && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse rounded-md bg-gps/25"
        />
      )}
      <span className="relative">
        <FollowGlyph mode={followMode} />
      </span>
    </button>
  );
}