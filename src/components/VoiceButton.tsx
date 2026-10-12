"use client";

import { SpeakerIcon, SpeakerMutedIcon } from "./Icons";

/**
 * Mute/unmute for spoken turn-by-turn. The host owns the actual speech and the
 * persisted preference; this button just relays intent and reflects state.
 */
export function VoiceButton({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle: (muted: boolean) => void;
}) {
  const label = muted ? "Voice guidance: muted" : "Voice guidance: on";
  return (
    <button
      type="button"
      onClick={() => onToggle(!muted)}
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      className={`btn-icon transition-colors ${
        muted ? "text-ink-2" : "bg-gps/10 text-gps-soft ring-1 ring-gps/40"
      }`}
    >
      {muted ? <SpeakerMutedIcon className="h-5 w-5" /> : <SpeakerIcon className="h-5 w-5" />}
    </button>
  );
}
